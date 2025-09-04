const nodemailer = require('nodemailer');

// Configure transporter (use your Gmail account)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'kalpeshbavaliya2005@gmail.com', // your email
        pass: 'zwfc shnj qwfh glgy'              // ⚠️ use Gmail App Password (not real password)
    }
});

async function sendMail(subject, message) {
    try {
        await transporter.sendMail({
            from: '"Result Processor" <kalpeshbavaliya2005@gmail.com>',
            to: 'kalpeshbavaliya2005@gmail.com',
            subject,
            text: message
        });
        console.log(`📧 Email sent: ${subject}`);
    } catch (err) {
        console.error('❌ Email send failed:', err.message);
    }
}

module.exports = { sendMail };
