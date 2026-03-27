/**
 * Hall Ticket Downloader Route
 * POST /generate-halltickets
 *
 * Target: https://mkbhavuni.edu.in/bhavuni-academic-new/online-hallticket/index.php
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const PQueue = require('p-queue').default;
const { launchBrowser } = require('../browser');
const { sendMail } = require('../mailer');

const router = express.Router();

// ─── Config ──────────────────────────────────────────────────────────────────
const HALLTICKET_URL = 'https://mkbhavuni.edu.in/bhavuni-academic-new/online-hallticket/index.php';
const MAX_CONCURRENCY = 3;   // parallel browsers
const MAX_RETRIES = 2;   // retries per student
const PAGE_TIMEOUT = 30000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build output folder like halltickets_sem6_2026 */
function getOutputDir(semesterId) {
    const year = new Date().getFullYear();
    const dir = path.join(process.cwd(), `halltickets_sem${semesterId}_${year}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** Download hall ticket PDF for a single student with retry logic */
async function downloadHallTicket(browser, student, attempt = 1) {
    const { enrollment, semesterId, courseId } = student;
    const pdfName = `${enrollment}_sem-${semesterId}.pdf`;
    const outDir = getOutputDir(semesterId);
    const pdfPath = path.join(outDir, pdfName);

    console.log(`📋 [${enrollment}] Attempt ${attempt} – course:${courseId}, sem:${semesterId}`);

    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 1280, height: 900 });

        // 1. Navigate
        await page.goto(HALLTICKET_URL, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });

        // 2. Select Course
        await page.waitForSelector('select[name="course_id"], select#course_id, select', { timeout: 10000 });

        // Try common selector patterns; selectors are configurable here
        const courseSelected = await page.evaluate((courseId) => {
            const selects = Array.from(document.querySelectorAll('select'));
            for (const sel of selects) {
                const opt = Array.from(sel.options).find(o => o.value == courseId);
                if (opt) { sel.value = courseId; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
            }
            return false;
        }, courseId);

        if (!courseSelected) throw new Error(`courseId ${courseId} not found in any dropdown`);
        console.log(`✅ [${enrollment}] Course selected: ${courseId}`);

        // 3. Wait for semester dropdown to populate dynamically
        await page.waitForFunction(
            (semId) => {
                const selects = Array.from(document.querySelectorAll('select'));
                for (const sel of selects) {
                    if (Array.from(sel.options).some(o => o.value == semId)) return true;
                }
                return false;
            },
            { timeout: 15000 },
            semesterId
        );

        // 4. Select Semester
        const semSelected = await page.evaluate((semesterId) => {
            const selects = Array.from(document.querySelectorAll('select'));
            for (const sel of selects) {
                const opt = Array.from(sel.options).find(o => o.value == semesterId);
                if (opt && sel.options.length > 1 && sel !== document.querySelector('select')) {
                    sel.value = semesterId; sel.dispatchEvent(new Event('change', { bubbles: true })); return true;
                }
            }
            // fallback – pick second select
            if (selects.length >= 2) {
                const sel = selects[1];
                const opt = Array.from(sel.options).find(o => o.value == semesterId);
                if (opt) { sel.value = semesterId; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; }
            }
            return false;
        }, semesterId);

        if (!semSelected) throw new Error(`semesterId ${semesterId} not found in semester dropdown`);
        console.log(`✅ [${enrollment}] Semester selected: ${semesterId}`);

        // 5. Enter Enrollment Number
        const enrollmentInput = await page.$('input[type="text"], input[name*="enroll"], input[name*="sid"], input[name*="roll"]');
        if (!enrollmentInput) throw new Error('Enrollment input field not found');
        await enrollmentInput.click({ clickCount: 3 });
        await enrollmentInput.type(String(enrollment));
        console.log(`✅ [${enrollment}] Enrollment entered`);

        // 6. Click Search
        const searchBtn = await page.$('input[type="submit"], button[type="submit"], button');
        if (!searchBtn) throw new Error('Search button not found');
        await searchBtn.click();

        // 7. Wait for hall ticket content
        await Promise.race([
            page.waitForSelector('table, .hallticket, #hallticket, .print', { timeout: 20000 }),
            page.waitForNavigation({ timeout: 20000, waitUntil: 'networkidle2' })
        ]);

        // Check for error messages
        const bodyText = await page.evaluate(() => document.body.innerText);
        if (/invalid|not found|no record|error/i.test(bodyText)) {
            throw new Error(`Portal returned: ${bodyText.substring(0, 120)}`);
        }

        // 8. Generate PDF (A4, with background)
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' }
        });

        console.log(`📄 [${enrollment}] PDF saved → ${pdfPath}`);
        return { success: true, enrollment, pdfName, pdfPath };

    } catch (err) {
        // Retry logic
        if (attempt < MAX_RETRIES) {
            console.warn(`⚠️  [${enrollment}] Retrying (${attempt}/${MAX_RETRIES}): ${err.message}`);
            await page.close().catch(() => { });
            await new Promise(r => setTimeout(r, 2000));
            return downloadHallTicket(browser, student, attempt + 1);
        }
        console.error(`❌ [${enrollment}] Failed after ${MAX_RETRIES} attempts: ${err.message}`);
        return { success: false, enrollment, error: err.message };

    } finally {
        await page.close().catch(() => { });
    }
}

// ─── Background Processor ─────────────────────────────────────────────────────

async function processHallTickets(students) {
    const queue = new PQueue({ concurrency: MAX_CONCURRENCY });
    const results = [];
    let browser;

    try {
        browser = await launchBrowser();

        await Promise.all(
            students.map(student =>
                queue.add(async () => {
                    const result = await downloadHallTicket(browser, student);
                    results.push(result);
                })
            )
        );
    } finally {
        if (browser) await browser.close().catch(() => { });
    }

    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`\n✅ Hall Tickets Done → Success: ${succeeded.length}, ❌ Failed: ${failed.length}`);

    // ── Send formatted email ──────────────────────────────────────────────────
    await sendHallTicketEmail(succeeded, failed, students.length);

    return { succeeded, failed };
}

// ─── HTML Email Builder ───────────────────────────────────────────────────────

async function sendHallTicketEmail(succeeded, failed, total) {
    const isAllOk = failed.length === 0;
    const subject = isAllOk
        ? `✅ Hall Tickets Generated – All ${total} processed`
        : `⚠️ Hall Tickets – ${succeeded.length}/${total} OK, ${failed.length} Failed`;

    const title = isAllOk
        ? `🎉 All ${total} hall tickets downloaded successfully!`
        : `📊 Hall Ticket Report: ${succeeded.length} succeeded, ${failed.length} failed`;

    // Summary row
    const summaryRow = `
      <p><strong>Total Students:</strong> ${total} &nbsp;|&nbsp;
         <strong>✅ Succeeded:</strong> ${succeeded.length} &nbsp;|&nbsp;
         <strong>❌ Failed:</strong> ${failed.length}</p>`;

    // Success table
    let successTable = '';
    if (succeeded.length > 0) {
        const rows = succeeded.map(s =>
            `<tr><td>${s.enrollment}</td><td>${s.pdfName}</td><td><span class="badge-ok">✅ Done</span></td></tr>`
        ).join('');
        successTable = `
        <h3 style="color:#2e7d32">✅ Successfully Generated</h3>
        <table>
          <thead><tr><th>Enrollment</th><th>File Name</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    // Failure table
    let failTable = '';
    if (failed.length > 0) {
        const rows = failed.map(s =>
            `<tr><td>${s.enrollment}</td><td>${s.error || 'Unknown error'}</td><td><span class="badge-fail">❌ Failed</span></td></tr>`
        ).join('');
        failTable = `
        <h3 style="color:#c62828; margin-top:24px">❌ Failed Downloads</h3>
        <table>
          <thead><tr><th>Enrollment</th><th>Reason</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    const bodyHtml = summaryRow + successTable + failTable;
    await sendMail(subject, title, bodyHtml);
}

// ─── API Route ────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
    const { students } = req.body;

    if (!students || !Array.isArray(students) || students.length === 0) {
        return res.status(400).json({
            status: false,
            message: 'students array is required and must not be empty'
        });
    }

    // Validate each student entry
    const invalid = students.filter(s => !s.enrollment || !s.semesterId || !s.courseId);
    if (invalid.length > 0) {
        return res.status(400).json({
            status: false,
            message: 'Each student must have enrollment, semesterId, and courseId',
            invalid
        });
    }

    console.log(`🚀 Hall Ticket request: ${students.length} students`);

    // Immediate ACK
    res.json({
        status: true,
        message: 'Hall ticket generation started in background',
        total: students.length
    });

    // Fire-and-forget
    processHallTickets(students).catch(err =>
        console.error('❌ Hall ticket queue error:', err.message)
    );
});

module.exports = router;
