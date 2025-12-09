const axios = require('axios');
const fs = require('fs');

async function testFirmwareScraping() {
  try {
    console.log('Testing Nintendo firmware scraping...');
    const response = await axios.get('https://en-americas-support.nintendo.com/app/answers/detail/a_id/43314/~/system-update-history-for-nintendo-switch', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const html = response.data;
    console.log('Page fetched successfully, length:', html.length);

    // Test version extraction
    const versionPatterns = [
      /System Update Version ([0-9]+\.[0-9]+\.[0-9]+)/i,
      /version ([0-9]+\.[0-9]+\.[0-9]+)/i,
      /([0-9]+\.[0-9]+\.[0-9]+).*?system update/i,
      /firmware.*?([0-9]+\.[0-9]+\.[0-9]+)/i
    ];

    let latestVersion = 'Unknown';
    for (const pattern of versionPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        if (/^\d+\.\d+\.\d+$/.test(match[1])) {
          latestVersion = match[1];
          console.log('Found version with pattern:', pattern, '->', latestVersion);
          break;
        }
      }
    }

    // Test date extraction
    const datePatterns = [
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i,
      /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i,
      /\d{1,2}\/\d{1,2}\/\d{4}/,
      /\d{4}-\d{2}-\d{2}/
    ];

    let latestDate = 'Unknown date';
    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match && match[0]) {
        latestDate = match[0];
        console.log('Found date with pattern:', pattern, '->', latestDate);
        break;
      }
    }

    console.log('Scraping test completed.');
    console.log('Version found:', latestVersion);
    console.log('Date found:', latestDate);

    // Save a sample of the HTML for inspection
    const sampleHtml = html.substring(0, 2000);
    fs.writeFileSync('nintendo-page-sample.html', sampleHtml);
    console.log('Saved HTML sample to nintendo-page-sample.html');

  } catch (error) {
    console.error('Scraping test failed:', error.message);
  }
}

testFirmwareScraping();

