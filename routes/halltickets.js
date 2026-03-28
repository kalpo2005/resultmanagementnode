/**
 * Hall Ticket Downloader Route
 * POST /generate-halltickets
 *
 * Target: https://mkbhavuni.edu.in/bhavuni-academic-new/online-hallticket/index.php
 *
 * Portal DOM structure (confirmed):
 *   Page 1: #print_button, #tblInstruct, <div style="page-break-after:always;">
 *   Page 2: .ColHeaderName (logo+title), #tblInfo, #tblSubject, photo, QR code
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const PQueue = require('p-queue').default;
const { launchBrowser } = require('../browser');
const { sendMail } = require('../mailer');

const router = express.Router();

// ─── Config ──────────────────────────────────────────────────────────────────
const HALLTICKET_URL = 'https://mkbhavuni.edu.in/bhavuni-academic-new/online-hallticket/index.php';
const MAX_CONCURRENCY = 5;  // parallel browsers → 200 tickets in ~1-2 min
const MAX_RETRIES = 2;
const PAGE_TIMEOUT = 30000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build output folder like halltickets_sem6_2026 */
function getOutputDir(semesterId) {
    const year = new Date().getFullYear();
    const dir = path.join(process.cwd(), `halltickets/${year}/sem_${semesterId}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Fetch any URL from Node.js (no CORS, no browser restrictions).
 * Returns a data URI string or null on failure.
 */
function fetchAsBase64Node(url) {
    return new Promise((resolve) => {
        try {
            const mod = url.startsWith('https') ? https : http;
            const req = mod.get(url, { timeout: 15000 }, (res) => {
                // Follow one redirect
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return resolve(fetchAsBase64Node(res.headers.location));
                }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const mime = (res.headers['content-type'] || 'image/jpeg').split(';')[0];
                    const b64 = Buffer.concat(chunks).toString('base64');
                    resolve(`data:${mime};base64,${b64}`);
                });
                res.on('error', () => resolve(null));
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        } catch (_) {
            resolve(null);
        }
    });
}

// ─── Core Downloader ──────────────────────────────────────────────────────────

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

        // ── 1. Navigate ───────────────────────────────────────────────────────
        await page.goto(HALLTICKET_URL, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });

        // ── 2. Select Course ──────────────────────────────────────────────────
        await page.waitForSelector('select', { timeout: 10000 });
        const courseSelected = await page.evaluate((courseId) => {
            for (const sel of document.querySelectorAll('select')) {
                const opt = Array.from(sel.options).find(o => o.value == courseId);
                if (opt) {
                    sel.value = courseId;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        }, courseId);
        if (!courseSelected) throw new Error(`courseId ${courseId} not found in dropdown`);
        console.log(`  ✅ [${enrollment}] Course selected`);

        // ── 3. Wait for semester dropdown to populate ─────────────────────────
        await page.waitForFunction(
            (semId) => Array.from(document.querySelectorAll('select'))
                .some(sel => Array.from(sel.options).some(o => o.value == semId)),
            { timeout: 15000 },
            semesterId
        );

        // ── 4. Select Semester ────────────────────────────────────────────────
        const semSelected = await page.evaluate((semesterId) => {
            const selects = Array.from(document.querySelectorAll('select'));
            // The semester dropdown is the 2nd select on this portal
            for (let i = 1; i < selects.length; i++) {
                const opt = Array.from(selects[i].options).find(o => o.value == semesterId);
                if (opt) {
                    selects[i].value = semesterId;
                    selects[i].dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            // Fallback: any select
            for (const sel of selects) {
                const opt = Array.from(sel.options).find(o => o.value == semesterId);
                if (opt && sel.options.length > 1) {
                    sel.value = semesterId;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
            }
            return false;
        }, semesterId);
        if (!semSelected) throw new Error(`semesterId ${semesterId} not found`);
        console.log(`  ✅ [${enrollment}] Semester selected`);

        // ── 5. Enter Enrollment Number ────────────────────────────────────────
        const enrollmentInput = await page.$('input[type="text"]');
        if (!enrollmentInput) throw new Error('Enrollment input not found');
        await enrollmentInput.click({ clickCount: 3 });
        await enrollmentInput.type(String(enrollment));
        console.log(`  ✅ [${enrollment}] Enrollment entered`);

        // ── 6. Click Search ───────────────────────────────────────────────────
        const searchBtn = await page.$('input[type="submit"], button[type="submit"], button');
        if (!searchBtn) throw new Error('Search button not found');
        await searchBtn.click();

        // ── 7. Wait for hall ticket tables (exact IDs from portal DOM) ────────
        await page.waitForSelector('#tblInfo, #tblSubject, .ColHeaderName', { timeout: 25000 });
        console.log(`  ✅ [${enrollment}] Hall ticket DOM loaded`);

        // ── 7a. Let network settle (images begin loading) ─────────────────────
        await page.waitForNetworkIdle({ idleTime: 800, timeout: 20000 }).catch(() => { });

        // ── 7b. Scroll to bottom → forces student photo + QR code to load ─────
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 1000));
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => { });

        // ── 7c. Error check ───────────────────────────────────────────────────
        const hasTicketTable = await page.$('#tblInfo');
        if (!hasTicketTable) {
            const bodyText = await page.evaluate(() => document.body.innerText);
            throw new Error(`No hall ticket found: ${bodyText.substring(0, 120)}`);
        }

        // ── 8. Inline ALL images via Node.js https (bypasses CORS entirely) ───
        //  We collect URLs first, then replace BY INDEX so special chars in URLs
        //  (?, =, &) don't break CSS selectors or string matching.
        const imgSrcs = await page.evaluate(() =>
            Array.from(document.images).map(img => img.src)
        );
        console.log(`  🖼  [${enrollment}] Inlining ${imgSrcs.length} image(s)...`);

        for (let i = 0; i < imgSrcs.length; i++) {
            const src = imgSrcs[i];
            if (!src || src.startsWith('data:')) continue;

            const dataUri = await fetchAsBase64Node(src);
            if (dataUri) {
                await page.evaluate((idx, d) => {
                    const imgs = Array.from(document.images);
                    if (imgs[idx]) imgs[idx].src = d;
                }, i, dataUri);
                console.log(`     [${i}] ✅ ${Math.round(dataUri.length / 1024)}KB inlined`);
            } else {
                console.warn(`     [${i}] ⚠️  Failed to fetch: ${src.substring(0, 80)}`);
            }
        }

        // ── 9. Remove instructions page using exact portal IDs ────────────────
        //  From DOM: page 1 = #print_button + #tblInstruct + <div page-break>
        //            page 2 = .ColHeaderName + #tblInfo + #tblSubject + photo/QR
        await page.evaluate(() => {
            // Remove print button
            document.getElementById('print_button')?.remove();

            // Remove instructions table
            document.getElementById('tblInstruct')?.remove();

            // Remove page-break divider
            document.querySelectorAll('div[style*="page-break"]').forEach(el => el.remove());

            // Remove any other do-not-print elements
            document.querySelectorAll('.do-not-print').forEach(el => el.remove());
        });

        // ── 10. Scroll to top so PDF renders from start of hall ticket ────────
        await page.evaluate(() => window.scrollTo(0, 0));

        // ── 11. Generate PDF ──────────────────────────────────────────────────
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' }
        });

        console.log(`  📄 [${enrollment}] PDF saved → ${pdfPath}`);
        return { success: true, enrollment, pdfName, pdfPath };

    } catch (err) {
        if (attempt < MAX_RETRIES) {
            console.warn(`  ⚠️  [${enrollment}] Retrying (${attempt}/${MAX_RETRIES}): ${err.message}`);
            await page.close().catch(() => { });
            await new Promise(r => setTimeout(r, 2000));
            return downloadHallTicket(browser, student, attempt + 1);
        }
        console.error(`  ❌ [${enrollment}] Failed: ${err.message}`);
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
    const failed    = results.filter(r => !r.success);

    console.log(`\n✅ Hall Tickets Done → Success: ${succeeded.length}, ❌ Failed: ${failed.length}`);

    // ── Save failed students JSON for easy retry ──────────────────────────────
    if (failed.length > 0) {
        // Build retry-ready objects (same shape that the API accepts)
        const failedStudentsList = students.filter(s =>
            failed.some(f => String(f.enrollment) === String(s.enrollment))
        ).map(s => ({
            enrollment: s.enrollment,
            semesterId: s.semesterId,
            courseId:   s.courseId,
            // failReason: (failed.find(f => String(f.enrollment) === String(s.enrollment)) || {}).error || 'Unknown'
        }));

        const year       = new Date().getFullYear();
        const failDir    = path.join(process.cwd(), `halltickets/${year}`);
        if (!fs.existsSync(failDir)) fs.mkdirSync(failDir, { recursive: true });

        const timestamp  = new Date().toISOString().replace(/[:.]/g, '-');
        const failFile   = path.join(failDir, `failed_students_${timestamp}.json`);
        fs.writeFileSync(failFile, JSON.stringify(failedStudentsList, null, 2), 'utf8');
        console.log(`💾 Failed list saved → ${failFile}  (${failed.length} student${failed.length > 1 ? 's' : ''})`);
    }

    await sendHallTicketEmail(succeeded, failed, students.length);

    return { succeeded, failed };
}

// ─── HTML Email Builder ───────────────────────────────────────────────────────

async function sendHallTicketEmail(succeeded, failed, total) {
    const isAllOk = failed.length === 0;
    const pct = Math.round((succeeded.length / total) * 100);

    const subject = isAllOk
        ? `✅ Hall Tickets Ready – All ${total} Students [MKBU]`
        : `⚠️ Hall Tickets – ${succeeded.length}/${total} Generated [MKBU]`;

    const title = isAllOk
        ? `🎉 All ${total} hall tickets generated successfully!`
        : `📊 Hall Ticket Report: ${succeeded.length} of ${total} completed`;

    // ── Stat cards ────────────────────────────────────────────────────────────
    const statCards = `
    <div class="stats">
      <div class="stat stat-total">
        <div class="stat-num">${total}</div>
        <div class="stat-lbl">📋 Total</div>
      </div>
      <div class="stat stat-ok">
        <div class="stat-num">${succeeded.length}</div>
        <div class="stat-lbl">✅ Success</div>
      </div>
      <div class="stat stat-fail">
        <div class="stat-num">${failed.length}</div>
        <div class="stat-lbl">❌ Failed</div>
      </div>
    </div>`;

    // ── Progress bar ──────────────────────────────────────────────────────────
    const progressBar = `
    <div class="prog-wrap">
      <div class="prog-top">
        <span><strong>Completion Rate</strong></span>
        <span><strong>${pct}%</strong> (${succeeded.length} / ${total})</span>
      </div>
      <div class="prog-bar">
        <div class="prog-fill" style="width:${pct}%"></div>
      </div>
    </div>
    <hr class="divider">`;

    // ── Success table ─────────────────────────────────────────────────────────
    let successTable = '';
    if (succeeded.length > 0) {
        const rows = succeeded.map((s, i) => `
          <tr>
            <td style="color:#888;font-size:12px">${i + 1}</td>
            <td><strong>${s.enrollment}</strong></td>
            <td style="font-size:12.5px;color:#555">${s.pdfName}</td>
            <td><span class="badge badge-ok">✅ Done</span></td>
          </tr>`).join('');
        successTable = `
        <div class="sec-title sec-ok">✅ Successfully Generated &nbsp;(${succeeded.length})</div>
        <table>
          <thead><tr><th>#</th><th>Enrollment ID</th><th>PDF File</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    // ── Failure table ─────────────────────────────────────────────────────────
    let failTable = '';
    if (failed.length > 0) {
        const rows = failed.map((s, i) => `
          <tr>
            <td style="color:#888;font-size:12px">${i + 1}</td>
            <td><strong>${s.enrollment}</strong></td>
            <td style="font-size:12px;color:#b71c1c">${s.error || 'Unknown error'}</td>
            <td><span class="badge badge-fail">❌ Failed</span></td>
          </tr>`).join('');
        failTable = `
        <div class="sec-title sec-fail" style="margin-top:28px">❌ Failed Downloads &nbsp;(${failed.length})</div>
        <table>
          <thead><tr><th>#</th><th>Enrollment ID</th><th>Reason</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    await sendMail(subject, title, statCards + progressBar + successTable + failTable);
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

    const invalid = students.filter(s => !s.enrollment || !s.semesterId || !s.courseId);
    if (invalid.length > 0) {
        return res.status(400).json({
            status: false,
            message: 'Each student must have enrollment, semesterId, and courseId',
            invalid
        });
    }

    console.log(`🚀 Hall Ticket request: ${students.length} students`);

    res.json({
        status: true,
        message: 'Hall ticket generation started in background',
        total: students.length
    });

    processHallTickets(students).catch(err =>
        console.error('❌ Hall ticket queue error:', err.message)
    );
});

module.exports = router;
