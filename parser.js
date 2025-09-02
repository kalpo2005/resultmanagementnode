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
        if (th.includes('Seat Number')) studentDetails.seatInfo = td;
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
                        total_credits: $(cols[3]).text().trim(),
                        cce_max_min: $(cols[4]).text().trim(),
                        cce_obtained: $(cols[5]).text().trim(),
                        see_max_min: $(cols[6]).text().trim(),
                        see_obtained: $(cols[7]).text().trim(),
                        total_max_min: $(cols[8]).text().trim(),
                        total_obtained: $(cols[9]).text().trim(),
                        total_credit_points: $(cols[13]).text().trim()
                    };
                    return;
                }

                // SGPA and Result row
                if ($(row).find('font').text().includes('SGPA')) {
                    sgpa = $(row).find('font').text().match(/SGPA:\s*([\d.]+)/)?.[1] || '';
                    finalResult = $(row).find('font').text().match(/Result:\s*([A-Za-z]+)/)?.[1] || '';
                    return;
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
                    marks_percentage: $(cols[10]).text().trim(),
                    letter_grade: $(cols[11]).text().trim(),
                    grade_point: $(cols[12]).text().trim(),
                    credit_point: $(cols[13]).text().trim()
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

module.exports = { parseResultTable };
