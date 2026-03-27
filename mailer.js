const nodemailer = require('nodemailer');

// Configure transporter (use Gmail App Password)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'kalpeshbavaliya2005@gmail.com', // your email
    pass: 'zwfc shnj qwfh glgy'              // ⚠️ use Gmail App Password (not real password)
  }
});

/**
 * Send a richly formatted HTML email.
 * @param {string} subject
 * @param {string} title      - Bold header inside the email
 * @param {string} bodyHtml   - HTML body content (rows, lists, etc.)
 */
async function sendMail(subject, title, bodyHtml) {
  const now = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${subject}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#eef2f7;padding:24px 12px}
  .wrap{max-width:720px;margin:0 auto}

  /* ── Header ── */
  .hdr{background:linear-gradient(135deg,#1a237e 0%,#283593 60%,#3949ab 100%);
       border-radius:14px 14px 0 0;padding:32px 36px;color:#fff}
  .hdr-inner{display:flex;align-items:center;gap:16px}
  .hdr-icon{width:52px;height:52px;background:rgba(255,255,255,.15);border-radius:12px;
            display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0}
  .hdr-text h1{font-size:22px;font-weight:700;letter-spacing:.3px}
  .hdr-text p{font-size:12px;opacity:.75;margin-top:4px}

  /* ── Body ── */
  .body{background:#fff;padding:32px 36px;border-radius:0 0 14px 14px;
        box-shadow:0 4px 20px rgba(0,0,0,.08)}

  /* ── Stat cards ── */
  .stats{display:flex;gap:14px;margin-bottom:28px;flex-wrap:wrap}
  .stat{flex:1;min-width:130px;border-radius:10px;padding:16px 18px;text-align:center}
  .stat-total {background:#e8eaf6;border:1.5px solid #c5cae9}
  .stat-ok    {background:#e8f5e9;border:1.5px solid #a5d6a7}
  .stat-fail  {background:#ffebee;border:1.5px solid #ef9a9a}
  .stat-num{font-size:32px;font-weight:800;line-height:1}
  .stat-total .stat-num{color:#3949ab}
  .stat-ok    .stat-num{color:#2e7d32}
  .stat-fail  .stat-num{color:#c62828}
  .stat-lbl{font-size:12px;font-weight:600;margin-top:5px;text-transform:uppercase;letter-spacing:.5px;color:#666}

  /* ── Section title ── */
  .sec-title{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;
             padding:10px 14px;border-radius:6px;margin:24px 0 10px}
  .sec-ok  {background:#e8f5e9;color:#1b5e20}
  .sec-fail{background:#ffebee;color:#b71c1c}

  /* ── Tables ── */
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  thead tr{background:linear-gradient(90deg,#3949ab,#1a237e)}
  th{color:#fff;padding:11px 14px;text-align:left;font-weight:600;letter-spacing:.3px}
  td{padding:10px 14px;border-bottom:1px solid #eee;color:#333;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tbody tr:hover td{background:#f5f7ff}
  tbody tr:nth-child(even) td{background:#fafafa}
  tbody tr:nth-child(even):hover td{background:#f5f7ff}

  /* ── Badges ── */
  .badge{display:inline-block;padding:3px 11px;border-radius:20px;font-size:11.5px;font-weight:700}
  .badge-ok  {background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7}
  .badge-fail{background:#ffebee;color:#c62828;border:1px solid #ef9a9a}

  /* ── Progress bar ── */
  .prog-wrap{margin-bottom:24px}
  .prog-top{display:flex;justify-content:space-between;font-size:12.5px;color:#555;margin-bottom:6px}
  .prog-bar{height:8px;background:#eee;border-radius:4px;overflow:hidden}
  .prog-fill{height:100%;background:linear-gradient(90deg,#43a047,#66bb6a);border-radius:4px;transition:width .3s}

  /* ── Footer ── */
  .ftr{text-align:center;margin-top:18px;font-size:11.5px;color:#999}
  .ftr a{color:#3949ab;text-decoration:none}

  .divider{border:none;border-top:1px solid #eee;margin:24px 0}
</style>
</head>
<body>
<div class="wrap">

  <!-- Header -->
  <div class="hdr">
    <div class="hdr-inner">
      <div class="hdr-icon">🎓</div>
      <div class="hdr-text">
        <h1>MKB University – Hall Ticket System</h1>
        <p>Automated Report &nbsp;·&nbsp; ${now} IST</p>
      </div>
    </div>
  </div>

  <!-- Body -->
  <div class="body">

    <!-- Title banner -->
    <p style="font-size:17px;font-weight:700;color:#1a237e;margin-bottom:20px">${title}</p>

    ${bodyHtml}

  </div><!-- /body -->

  <!-- Footer -->
  <div class="ftr">
    This is an automated message from the <strong>Result Processing System</strong>.<br>
    Please do not reply to this email.
  </div>

</div>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: '"Hall Ticket System 🎓" <kalpesh05@gmail.com>',
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
