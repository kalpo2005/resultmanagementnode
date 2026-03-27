const nodemailer = require('nodemailer');

// Configure transporter (use Gmail App Password)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'kalpesh05@gmail.com',       // your Gmail
        pass: 'dfdfdfgdfgdffdgdf'           // ⚠️ Gmail App Password
    }
});

/**
 * Send a richly formatted HTML email.
 * @param {string} subject
 * @param {string} title      - Bold header inside the email
 * @param {string} bodyHtml   - HTML body content (rows, lists, etc.)
 */
async function sendMail(subject, title, bodyHtml) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body { font-family: Arial, sans-serif; background:#f4f6f9; margin:0; padding:20px; }
    .card { background:#fff; border-radius:8px; max-width:680px; margin:0 auto;
            box-shadow:0 2px 8px rgba(0,0,0,.12); overflow:hidden; }
    .header { background:#1a237e; color:#fff; padding:24px 32px; }
    .header h1 { margin:0; font-size:22px; }
    .header p  { margin:4px 0 0; font-size:13px; opacity:.8; }
    .body  { padding:24px 32px; }
    .summary-box { background:#e8eaf6; border-left:4px solid #3949ab;
                   border-radius:4px; padding:14px 18px; margin-bottom:20px; }
    table  { width:100%; border-collapse:collapse; margin-top:12px; font-size:14px; }
    th     { background:#3949ab; color:#fff; padding:10px 14px; text-align:left; }
    td     { padding:9px 14px; border-bottom:1px solid #e0e0e0; }
    tr:last-child td { border-bottom:none; }
    tr:nth-child(even) td { background:#f5f5f5; }
    .badge-ok   { background:#e8f5e9; color:#2e7d32; padding:3px 10px;
                  border-radius:12px; font-size:12px; font-weight:bold; }
    .badge-fail { background:#ffebee; color:#c62828; padding:3px 10px;
                  border-radius:12px; font-size:12px; font-weight:bold; }
    .footer { background:#f1f3f4; text-align:center; padding:14px;
              font-size:12px; color:#757575; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>🎓 MKB University – Hall Ticket System</h1>
      <p>Automated Notification · ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
    </div>
    <div class="body">
      <div class="summary-box"><strong>${title}</strong></div>
      ${bodyHtml}
    </div>
    <div class="footer">This is an automated message from the Result Processing System.<br>Please do not reply.</div>
  </div>
</body>
</html>`;

    try {
        await transporter.sendMail({
            from: '"Hall Ticket System" <kalpesh05@gmail.com>',
            to: 'bbotad100@gmail.com',
            subject,
            html
        });
        console.log(`📧 Email sent: ${subject}`);
    } catch (err) {
        console.error('❌ Email send failed:', err.message);
    }
}

module.exports = { sendMail };
