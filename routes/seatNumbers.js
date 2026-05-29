const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const XLSX = require('xlsx');
const PQueue = require('p-queue').default;
const { launchBrowser } = require('../browser');

const router = express.Router();

// ─── Config ──────────────────────────────────────────────────────────────────
const HALLTICKET_URL = 'https://mkbhavuni.edu.in/bhavuni-academic-new/online-hallticket/index.php';
const MAX_CONCURRENCY = 5;
const MAX_RETRIES = 2;
const PAGE_TIMEOUT = 30000;
const SEATNUMBER_DIR = path.join(process.cwd(), 'seatnumber');
const SHEET_NAME = 'SeatNumbers';

// ─── Excel Helpers ────────────────────────────────────────────────────────────

/**
 * Load existing seat number mappings from all excel files in the seatnumber directory.
 * Returns a Map<enrollment, seatNumber> for O(1) lookups.
 */
function loadExcelMappings() {
    const map = new Map();

    if (!fs.existsSync(SEATNUMBER_DIR)) {
        console.log('📂 seatnumber directory not found – will create fresh.');
        return map;
    }

    try {
        const files = fs.readdirSync(SEATNUMBER_DIR).filter(f => f.endsWith('.xlsx'));
        for (const file of files) {
            const filePath = path.join(SEATNUMBER_DIR, file);
            const wb = XLSX.readFile(filePath);
            const ws = wb.Sheets[SHEET_NAME];
            if (!ws) continue;

            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            for (const row of rows) {
                const enrollment = String(row['Enrollment No'] || row['Enrollment Number'] || '').trim();
                const seat = String(row['Seat No'] || row['Seat Number'] || '').trim();
                if (enrollment && seat) {
                    map.set(enrollment, seat);
                }
            }
        }
        console.log(`📊 Loaded ${map.size} existing seat mappings from Excel files inside seatnumber directory.`);
    } catch (err) {
        console.error('⚠️  Failed to read Excel files from seatnumber directory:', err.message);
    }

    return map;
}

/**
 * Split a full name in "SURNAME FIRSTNAME MIDDLENAME" format into parts.
 * Handles 1-word, 2-word, and 3+-word names gracefully.
 */
function splitStudentName(fullName = '') {
    const parts = fullName.trim().split(/\s+/);
    const surname    = parts[0]  || '';
    const firstName  = parts[1]  || '';
    const middleName = parts.slice(2).join(' ') || '';
    return { surname, firstName, middleName };
}

/**
 * Append new {enrollment, seatNumber} rows to their respective semester Excel files.
 * Preserves existing rows and simply adds new ones at the bottom.
 */
function appendToExcel(newRows) {
    if (!newRows || newRows.length === 0) return;

    // Ensure seatnumber directory exists
    if (!fs.existsSync(SEATNUMBER_DIR)) {
        fs.mkdirSync(SEATNUMBER_DIR, { recursive: true });
    }

    // Group rows by semesterId
    const rowsBySemester = {};
    for (const r of newRows) {
        const sem = r.semesterId || 'unknown';
        if (!rowsBySemester[sem]) {
            rowsBySemester[sem] = [];
        }
        rowsBySemester[sem].push(r);
    }

    for (const [semesterId, rows] of Object.entries(rowsBySemester)) {
        const excelFile = path.join(SEATNUMBER_DIR, `Semester_${semesterId}.xlsx`);
        let existingRows = [];

        if (fs.existsSync(excelFile)) {
            try {
                const wb = XLSX.readFile(excelFile);
                const ws = wb.Sheets[SHEET_NAME];
                if (ws) {
                    existingRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
                }
            } catch (err) {
                console.error(`⚠️  Could not read existing Excel for semester ${semesterId} append:`, err.message);
            }
        }

        const mappedNew = rows.map(r => {
            const { surname, firstName, middleName } = splitStudentName(r.studentName);
            return {
                'Seat No':     r.seatNumber,
                'Enrollment No': r.enrollment,
                'Surname':     surname,
                'First Name':  firstName,
                'Middle Name': middleName,
                'Semester':    r.semesterId,
                'Course ID':   r.courseId,
                'Fetched At':  new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
            };
        });

        const allRows = [...existingRows, ...mappedNew];
        const ws = XLSX.utils.json_to_sheet(allRows);

        // Style column widths
        ws['!cols'] = [
            { wch: 16 }, // Seat No
            { wch: 22 }, // Enrollment No
            { wch: 20 }, // Surname
            { wch: 20 }, // First Name
            { wch: 20 }, // Middle Name
            { wch: 12 }, // Semester
            { wch: 12 }, // Course ID
            { wch: 24 }, // Fetched At
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
        XLSX.writeFile(wb, excelFile);

        console.log(`💾 Excel updated – added ${rows.length} row(s) to Semester ${semesterId} → ${excelFile}`);
    }
}

// ─── Core Scraper ─────────────────────────────────────────────────────────────

/** Scrape seat number for a single student with retry logic */
async function fetchSeatNumber(browser, student, attempt = 1) {
    const { enrollment, semesterId, courseId } = student;
    console.log(`🔍 [${enrollment}] Attempt ${attempt} – sem:${semesterId}, course:${courseId}`);

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
            for (let i = 1; i < selects.length; i++) {
                const opt = Array.from(selects[i].options).find(o => o.value == semesterId);
                if (opt) {
                    selects[i].value = semesterId;
                    selects[i].dispatchEvent(new Event('change', { bubbles: true }));
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

        // ── 7. Wait for hall ticket tables ────────────────────────────────────
        await page.waitForSelector('#tblInfo, #tblSubject, .ColHeaderName', { timeout: 25000 });
        console.log(`  ✅ [${enrollment}] Hall ticket DOM loaded`);

        // ── 8. Extract Seat Number & Student Name ─────────────────────────────
        // Seat:  <th align="right">SEAT NUMBER : <font size="+1">26860604</font></th>
        // Name:  <th align="left" colspan="2">STUDENT NAME : BAVALIYA KALPESHBHAI JAGDISHBHAI</th>
        const { seatNumber, studentName } = await page.evaluate(() => {
            const allTh = Array.from(document.querySelectorAll('th'));
            let seatNumber  = null;
            let studentName = null;

            for (const th of allTh) {
                const text = th.textContent.trim();

                if (!seatNumber && text.includes('SEAT NUMBER')) {
                    const font = th.querySelector('font');
                    if (font) {
                        seatNumber = font.textContent.trim();
                    } else {
                        const m = text.match(/SEAT NUMBER\s*:\s*(\S+)/);
                        if (m) seatNumber = m[1].trim();
                    }
                }

                if (!studentName && text.includes('STUDENT NAME')) {
                    const m = text.match(/STUDENT NAME\s*:\s*(.+)/);
                    if (m) studentName = m[1].trim();
                }

                if (seatNumber && studentName) break;
            }

            return { seatNumber, studentName };
        });

        if (!seatNumber) {
            const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
            throw new Error(`Seat number not found in DOM. Page text: ${bodyText}`);
        }

        console.log(`  🎯 [${enrollment}] Seat: ${seatNumber} | Name: ${studentName}`);
        return { success: true, enrollment, seatNumber, studentName: studentName || '', semesterId, courseId };

    } catch (err) {
        if (attempt < MAX_RETRIES) {
            console.warn(`  ⚠️  [${enrollment}] Retrying (${attempt}/${MAX_RETRIES}): ${err.message}`);
            await page.close().catch(() => { });
            await new Promise(r => setTimeout(r, 2000));
            return fetchSeatNumber(browser, student, attempt + 1);
        }
        console.error(`  ❌ [${enrollment}] Failed: ${err.message}`);
        return { success: false, enrollment, error: err.message };

    } finally {
        await page.close().catch(() => { });
    }
}

// ─── Background Processor ─────────────────────────────────────────────────────

async function processSeatNumbers(students) {
    const queue = new PQueue({ concurrency: MAX_CONCURRENCY });
    const succeeded = [];
    const failed = [];
    let browser;

    try {
        browser = await launchBrowser();

        await Promise.all(
            students.map(student =>
                queue.add(async () => {
                    const result = await fetchSeatNumber(browser, student);
                    if (result.success) {
                        succeeded.push(result);
                        // Append to Excel immediately after each success
                        appendToExcel([result]);
                    } else {
                        failed.push(result);
                    }
                })
            )
        );
    } finally {
        if (browser) await browser.close().catch(() => { });
    }

    console.log(`\n✅ Seat Numbers Done → Success: ${succeeded.length}, ❌ Failed: ${failed.length}`);

    if (failed.length > 0) {
        console.log('\n❌ Failed enrollments:');
        failed.forEach(f => console.log(`   - ${f.enrollment}: ${f.error}`));
    }

    return { succeeded, failed };
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

    // ── Check Excel and Skip Already Fetched ──────────────────────────────────
    const existingMappings = loadExcelMappings();

    const toFetch = [];
    const skipped = [];

    for (const s of students) {
        const key = String(s.enrollment).trim();
        if (existingMappings.has(key)) {
            skipped.push({ enrollment: key, seatNumber: existingMappings.get(key) });
        } else {
            toFetch.push(s);
        }
    }

    console.log(`\n🚀 Seat Number request: ${students.length} total | ${skipped.length} skipped (cached) | ${toFetch.length} to fetch`);
    skipped.forEach(s => console.log(`   ⏭  [${s.enrollment}] Skipped – already in Excel (${s.seatNumber})`));

    res.json({
        status: true,
        message: toFetch.length === 0
            ? 'All seat numbers already cached in Excel – nothing to fetch!'
            : `Seat number fetching started in background for ${toFetch.length} student(s). ${skipped.length} skipped (already cached).`,
        total: students.length,
        to_fetch: toFetch.length,
        skipped: skipped.length,
        cached: skipped
    });

    if (toFetch.length > 0) {
        processSeatNumbers(toFetch).catch(err =>
            console.error('❌ Seat number queue error:', err.message)
        );
    }
});

// ─── GET: View all cached seat numbers ───────────────────────────────────────

router.get('/', (req, res) => {
    const mappings = loadExcelMappings();
    const data = [];
    mappings.forEach((seatNumber, enrollment) => {
        data.push({ enrollment, seatNumber });
    });

    res.json({
        status: true,
        total: data.length,
        data
    });
});

module.exports = router;
