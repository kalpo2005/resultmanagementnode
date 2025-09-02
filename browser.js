const puppeteer = require('puppeteer-core');
const fs = require('fs');

function getBrowserPath() {
    const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (let p of possiblePaths) if (fs.existsSync(p)) return p;
    throw new Error('Chrome/Edge not found. Please install Chrome or Edge.');
}

async function launchBrowser() {
    return await puppeteer.launch({
        headless: true,
        executablePath: getBrowserPath()
    });
}

module.exports = { launchBrowser };
