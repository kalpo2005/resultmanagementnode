const cheerio = require('cheerio');

function parseResultTable(html) {
    const $ = cheerio.load(html);

    // ===== Student Details =====
    const studentDetails = {};
    $('table.print1').first().find('tr').each((i, row) => {
        const th = $(row).find('th').text().trim();
        const td = $(row).find('td').text().trim();

        if (th.includes('Student Name')) studentDetails.name = td;
        if (th.includes('College')) studentDetails.college = td;
        if (th.includes('Seat Number')) {
            const parts = td.split('|').map(p => p.trim());
            // Safe parsing
            studentDetails.seatnumber = parts[0] || null;
            const uniqueMatch = td.match(/Unique ID:\s*([0-9]+)/);
            studentDetails.enrollment = uniqueMatch ? uniqueMatch[1] : null;
            const abcMatch = td.match(/ABC ID:\s*([0-9]+)/);
            studentDetails.abcId = abcMatch ? abcMatch[1] : null;
        }

        if (th.includes('Programme')) studentDetails.programme = td;
        if (th.includes('Examination held in')) studentDetails.examHeldIn = td;
        if (th.includes('Exam Type')) studentDetails.examType = td;
    });

    // ===== Result Table =====
    let subjects = [];
    let totalMarks = {};
    let sgpa = '';
    let finalResult = '';

    $('table').each((i, table) => {
        const heading = $(table).find('th').first().text().trim();

        if (heading.includes('Result Details')) {
            const rows = $(table).find('tr').slice(2); // skip header rows

            rows.each((index, row) => {
                const cols = $(row).find('td, th');

                // TOTAL row
                if ($(cols[0]).text().trim().toLowerCase().includes('total')) {
                    totalMarks = {
                        total_credits: $(cols[1]).text().trim(),
                        cce_max_min: $(cols[2]).text().trim(),
                        cce_obtained: $(cols[3]).text().trim(),
                        see_max_min: $(cols[4]).text().trim(),
                        see_obtained: $(cols[5]).text().trim(),
                        total_max_min: $(cols[6]).text().trim(),
                        total_obtained: $(cols[7]).text().trim(),
                        total_credit_points: $(cols[9]).text().trim()
                    };
                    return;
                }

                // SGPA and Result row
                if ($(row).find('font').text().includes('SGPA')) {
                    sgpa = $(row).find('font').text().match(/SGPA:\s*([\d.]+)/)?.[1] || '';
                    finalResult = $(row).find('font').text().match(/Result:\s*([A-Za-z]+)/)?.[1] || '';
                    return;
                } else {
                    sgpa = 0;
                    finalResult = $(row).find('font').text().match(/Result:\s*([A-Za-z]+)/)?.[1] || '';
                }

                // Skip if not a valid subject row
                if (cols.length <= 10) return;

                // ===== Subjects =====
                subjects.push({
                    subject_code: $(cols[0]).text().trim(),
                    subject_type: $(cols[1]).text().trim(),
                    subject_name: $(cols[2]).text().trim(),
                    credit: $(cols[3]).text().trim(),
                    cce_max_min: $(cols[4]).text().trim(),
                    cce_obtained: $(cols[5]).text().trim(),
                    see_max_min: $(cols[6]).text().trim(),
                    see_obtained: $(cols[7]).text().trim(),
                    total_max_min: $(cols[8]).text().trim(),
                    total_obtained: $(cols[9]).text().trim(),
                    marks_percentage: $(cols[10]).text().trim() || 0.00,
                    letter_grade: $(cols[11]).text().trim() || 'F',
                    grade_point: $(cols[12]).text().trim() || 0.00,
                    credit_point: $(cols[13]).text().trim() || 0.00
                });
            });
        }
    });

    return {
        student: studentDetails,
        subjects,
        result: {
            sgpa,
            final_result: finalResult,
            total: totalMarks
        }
    };
}

// =====================================================================
// Semester 6 — same layout + extra Final Result row (CGPA / % / Grade)
// =====================================================================
function parseResultTableSem6(html) {
    const $ = cheerio.load(html);

    // Safe column accessor — handles fewer or more columns than expected
    const getCol = (cols, i) => (cols[i] ? $(cols[i]).text().trim() : '');

    // ===== Student Details =====
    // The student details <table border="1"> is nested inside table.print1,
    // so .find('tr') recursively finds those rows correctly.
    const studentDetails = {};
    $('table.print1').first().find('tr').each((i, row) => {
        const th = $(row).find('th').text().trim();
        const td = $(row).find('td').text().trim();

        if (th.includes('Student Name')) studentDetails.name = td;
        if (th.includes('College'))      studentDetails.college = td;
        if (th.includes('Seat Number')) {
            studentDetails.seatnumber = td.split('|')[0]?.trim() || null;
            const uniqueMatch = td.match(/Unique ID:\s*([0-9]+)/);
            studentDetails.enrollment = uniqueMatch ? uniqueMatch[1] : null;
            const abcMatch = td.match(/ABC ID:\s*([0-9]+)/);
            studentDetails.abcId = abcMatch ? abcMatch[1] : null;
        }
        if (th.includes('Programme'))           studentDetails.programme  = td;
        if (th.includes('Examination held in')) studentDetails.examHeldIn = td;
        if (th.includes('Exam Type'))           studentDetails.examType   = td;
    });

    // ===== Result Table =====
    let subjects             = [];
    let totalMarks           = {};
    let sgpa                 = '';
    let finalResult          = '';
    let cgpa                 = '';   // ⭐ Sem 6 only
    let equivalentPercentage = '';   // ⭐ Sem 6 only
    let grade                = '';   // ⭐ Sem 6 only

    $('table').each((i, table) => {
        const heading = $(table).find('th').first().text().trim();

        if (!heading.includes('Result Details')) return;

        const rows = $(table).find('tr').slice(2); // skip 2 header rows

        rows.each((index, row) => {
            const cols    = $(row).find('td, th');
            const rowText = $(row).find('font').text();

            // ── TOTAL row ──────────────────────────────────────────────
            if (getCol(cols, 0).toLowerCase().includes('total')) {
                totalMarks = {
                    total_credits:       getCol(cols, 1),
                    cce_max_min:         getCol(cols, 2),
                    cce_obtained:        getCol(cols, 3),
                    see_max_min:         getCol(cols, 4),
                    see_obtained:        getCol(cols, 5),
                    total_max_min:       getCol(cols, 6),
                    total_obtained:      getCol(cols, 7),
                    total_credit_points: getCol(cols, 9)   // col 8 is empty colspan
                };
                return;
            }

            // ── SGPA + Result row ─────────────────────────────────────────
            // PASS  → "SGPA: 8.50  Result: PASS"  (has SGPA)
            // FAIL/WITHHELD/ATD → "   Result: FAIL"  (no SGPA text, font is blank)
            // Exclude the CGPA row which also contains "Result" via "Final Result:"
            const isResultRow = rowText.includes('SGPA') ||
                (rowText.includes('Result:') &&
                 !rowText.includes('Final Result') &&
                 !rowText.includes('CGPA'));
            if (isResultRow) {
                sgpa        = rowText.match(/SGPA:\s*([\d.]+)/)?.[1]      || '';
                finalResult = rowText.match(/Result:\s*([A-Za-z]+)/)?.[1] || '';
                return;
            }

            // ── ⭐ Sem 6 — Final Result row (CGPA / % / Grade) ──────────
            if (rowText.includes('CGPA')) {
                cgpa                 = rowText.match(/CGPA:\s*([\d.]+)/)?.[1]               || '';
                equivalentPercentage = rowText.match(/Equivalent Percentage:\s*(\d+)/)?.[1] || '';
                grade                = rowText.match(/Grade:\s*([A-Z+]+)/)?.[1]             || '';
                return;
            }

            // ── Skip non-subject rows (too few columns) ─────────────────
            if (cols.length <= 10) return;

            // ── Subject row — safe access handles missing columns ────────
            subjects.push({
                subject_code:     getCol(cols, 0),
                subject_type:     getCol(cols, 1),
                subject_name:     getCol(cols, 2),
                credit:           getCol(cols, 3),
                cce_max_min:      getCol(cols, 4),
                cce_obtained:     getCol(cols, 5),
                see_max_min:      getCol(cols, 6),
                see_obtained:     getCol(cols, 7),
                total_max_min:    getCol(cols, 8),
                total_obtained:   getCol(cols, 9),
                marks_percentage: getCol(cols, 10) || 0.00,
                letter_grade:     getCol(cols, 11) || 'F',
                grade_point:      getCol(cols, 12) || 0.00,
                credit_point:     getCol(cols, 13) || 0.00
            });
        });
    });

    return {
        student: studentDetails,
        subjects,
        result: {
            sgpa,
            final_result:          finalResult,
            total:                 totalMarks,
            // ⭐ Sem 6 extra fields
            cgpa,
            equivalent_percentage: equivalentPercentage,
            grade
        }
    };
}

module.exports = { parseResultTable, parseResultTableSem6 };
