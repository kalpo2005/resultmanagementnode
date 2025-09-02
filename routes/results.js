const express = require('express');
const { launchBrowser } = require('../browser');
const { parseResultTable } = require('../parser');

const router = express.Router();

// Helper function to call Laravel API using native fetch
async function callLaravelApi(payload) {
    const apiUrl = 'http://localhost:8000/api/result/subject/autocreate';

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data };
        }

        return { success: true, data };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

router.post('/', async (req, res) => {
    const { students } = req.body;

    if (!students || !Array.isArray(students)) {
        return res.status(400).json({ status: false, message: 'Students array is required' });
    }

    let browser;
    try {
        browser = await launchBrowser();

        const results = await Promise.all(
            students.map(async (student) => {
                const { enrollment, seatnumber, studentId, semesterId } = student;
                const page = await browser.newPage();
                const url = 'https://www.mkbhavuni.edu.in/bhavuni_result/result.php';

                await page.goto(url, { waitUntil: 'networkidle2' });

                await page.type('#sid', String(enrollment));
                await page.type('#seat_no', String(seatnumber));
                await page.click('input[name="search_seat_no"][value="View Result"]');

                try {
                    // Wait for the first result table
                    await page.waitForSelector('table.print1', { timeout: 10000 });

                    // Get full page content
                    const pageContent = await page.content();

                    // Parse the HTML to extract student info + result data
                    const parsedData = parseResultTable(pageContent);

                    // Prepare payload for Laravel API
                    const payload = {
                        seatnumber,
                        studentId,
                        semesterId,
                        examTypeId: parsedData.student.examTypeId || 1, // default/fallback
                        subjects: parsedData.subjects
                    };

                    // Call Laravel API
                    const apiResponse = await callLaravelApi(payload);

                    return {
                        enrollment,
                        seatnumber,
                        studentId,
                        semesterId,
                        // parsedData,
                        // apiResponse
                        message:"data inserted successfully"
                    };

                } catch (err) {
                    console.error(`Error fetching result for ${seatnumber}:`, err.message);
                    return {
                        enrollment,
                        seatnumber,
                        studentId,
                        semesterId,
                        parsedData: null,
                        apiResponse: { success: false, error: err.message }
                    };
                } finally {
                    await page.close();
                }
            })
        );

        res.json({ status: true, students: results });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ status: false, error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

module.exports = router;
