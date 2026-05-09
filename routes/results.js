const express = require('express');
const { launchBrowser } = require('../browser');
const { parseResultTable, parseResultTableSem6 } = require('../parser');
const PQueue = require('p-queue').default;
const { sendMail } = require('../mailer');

const router = express.Router();

// Helper to call Laravel API
async function callLaravelApi(payload, timeoutMs = 10000) {
    // const apiUrl = 'http://localhost:8000/api/result/subject/autocreate';
    // const apiUrl = 'https:/result.studymotion.in/api/result/subject/autocreate';
    const apiUrl = 'https:/bsc.studymotion.in/api/result/subject/autocreate';

    const jwtToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL2JzYy5zdHVkeW1vdGlvbi5pbi9hcGkvbG9naW5hZG1pbiIsImlhdCI6MTc3ODM0NTE1MSwiZXhwIjoxNzc4MzQ4NzUxLCJuYmYiOjE3NzgzNDUxNTEsImp0aSI6IlJCQzFZWjlLTEcyVXdYcHoiLCJzdWIiOiIxIiwicHJ2IjoiMjNiZDVjODk0OWY2MDBhZGIzOWU3MDFjNDAwODcyZGI3YTU5NzZmNyIsImFjdG9yX3R5cGUiOiJ1c2VyIn0.ESICrVhOllSl1Md9OM4C4BWY_Z001V4A1cMyncXfGXs';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        console.log("Payload", payload);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + jwtToken
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeout);

        const data = await response.json();
        if (!response.ok) return { success: false, error: data };
        return { success: true, data };
    } catch (error) {
        clearTimeout(timeout);
        return { success: false, error: error.message || 'Laravel API timeout' };
    }
}


// Background processing
async function processStudents(students) {
    const queue = new PQueue({ concurrency: 5 });
    const failedEnrollments = [];
    let successCount = 0;

    const browser = await launchBrowser();

    await Promise.all(
        students.map(student =>
            queue.add(async () => {
                const { enrollment, seatnumber, resultId, studentId, semesterId, examTypeId } = student;
                const page = await browser.newPage();

                try {
                    const url = 'https://www.mkbhavuni.edu.in/bhavuni_result/result.php';
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    // detect correct frame
                    let frame = page.mainFrame();
                    if (page.frames().length > 1) {
                        frame = page.frames().find(f => f.url().includes('result.php')) || frame;
                    }

                    // fill form
                    await frame.waitForSelector('#sid', { timeout: 10000 });
                    await frame.type('#sid', String(enrollment));

                    await frame.waitForSelector('#seat_no', { timeout: 10000 });
                    await frame.type('#seat_no', String(seatnumber));

                    await frame.click('input[name="search_seat_no"][value="View Result"]');

                    // ✅ Race between result table and error message
                    // ✅ Race between result table and error message
                    const resultOrError = await Promise.race([
                        frame.waitForSelector('table.print1', { timeout: 10000 }).then(() => 'table').catch(() => null),
                        frame.waitForSelector('#printContainer', { timeout: 10000 }).then(() => 'printContainer').catch(() => null)
                    ]);

                    const pageContent = await frame.content();

                    if (resultOrError === 'printContainer') {
                        if (pageContent.includes('Invalid SID') || pageContent.includes('Invalid Seat Number')) {
                            console.log(`❌ Invalid result for ${enrollment} / ${seatnumber}`);
                            failedEnrollments.push({ enrollment, seatnumber });
                            return; // skip API call
                        }

                        if (pageContent.includes('Your Result is ABSENT')) {
                            console.log(`⚠️ Absent result for ${enrollment} / ${seatnumber}`);

                            const payload = {
                                seatNumber: seatnumber,
                                resultId,
                                studentId,
                                semesterId,
                                examTypeId: examTypeId,
                                student: {
                                    enrollment,
                                    seatNumber: seatnumber,
                                    status: 'ABSENT'
                                },
                                subjects: [
                                    {
                                        subject_code: 'ABS',
                                        subject_name: 'ABSENT IN WHOLW EXAM',
                                        subject_type: 'ALL',
                                        credit: 0,
                                        cce_max_min: 'AB',
                                        cce_obtained: 'AB',
                                        see_max_min: 'AB',
                                        see_obtained: 'AB',
                                        total_max_min: 'AB',
                                        total_obtained: 'AB',
                                        marks_percentage: 0,
                                        letter_grade: 'F',
                                        grade_point: 0,
                                        credit_point: 0
                                    }
                                ],
                                result: {
                                    final_result: 'ABSENT',
                                    total: {
                                        cce_max_min: 'AB',
                                        see_max_min: 'AB',
                                        total_max_min: 'AB',
                                        cce_obtained: 0,
                                        see_obtained: 0,
                                        total_obtained: 0
                                    },
                                    sgpa: 0
                                }
                            };


                            const apiResponse = await callLaravelApi(payload);
                            console.log(`✅ API response for ${enrollment}:`, apiResponse);
                            if (apiResponse.success) {
                                successCount++;
                            } else {
                                failedEnrollments.push({ enrollment, seatnumber });
                            }
                            return;
                        }

                    }

                    if (resultOrError !== 'table') {
                        console.log(`❌ No result table for ${enrollment} / ${seatnumber}`);
                        failedEnrollments.push({ enrollment, seatnumber });
                        return;
                    }


                    if (resultOrError !== 'table') {
                        console.log(`❌ No result table for ${enrollment} / ${seatnumber}`);
                        failedEnrollments.push({ enrollment, seatnumber });
                        return;
                    }

                    // ✅ Choose parser based on semesterId
                    const parsedData = semesterId === 6
                        ? parseResultTableSem6(pageContent)
                        : parseResultTable(pageContent);

                    const payload = {
                        seatNumber: seatnumber,
                        resultId,
                        studentId,
                        semesterId,
                        examTypeId: examTypeId,
                        student: parsedData.student,
                        subjects: parsedData.subjects,
                        result: parsedData.result
                    };

                    const apiResponse = await callLaravelApi(payload);
                    console.log(`✅ API response for ${enrollment}:`, apiResponse);


                    if (apiResponse.success) {
                        successCount++;
                    } else {
                        failedEnrollments.push({ enrollment, seatnumber });
                    }

                } catch (err) {
                    console.error(`❌ Error for ${enrollment}: ${err.message}`);
                    failedEnrollments.push({ enrollment, seatnumber });
                } finally {
                    await page.close();
                }
            })
        )
    );

    await browser.close();

    console.log(`✅ Done: ${successCount}, ❌ Failed: ${failedEnrollments.length}`);

    if (failedEnrollments.length) {
        const message = failedEnrollments
            .map(f => `Enrollment: ${f.enrollment}, Seat: ${f.seatnumber}`)
            .join('\n');

        await sendMail('❌ Failed Student Results', message);
    } else {
        await sendMail('✅ All Students Processed Successfully', `Total: ${successCount}`);
    }
}

// API route
router.post('/', async (req, res) => {
    const { students } = req.body;
    if (!students || !Array.isArray(students)) {
        return res.status(400).json({ status: false, message: 'Students array is required' });
    }
    console.log(`🚀 Received ${students.length} students for processing`);

    // Immediate response
    res.json({ status: true, message: 'Processing started in background', total: students.length });

    // Run background process (don’t await here)
    processStudents(students).catch(err => console.error('Queue Error:', err));
});

module.exports = router;
