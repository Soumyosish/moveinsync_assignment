const fs = require('fs');
const path = require('path');

// Operational threshold constraint
const CRITICAL_ALERT_THRESHOLD_PCT = 25.0; 

function generateAutomatedReport() {
    console.log("--------------------------------------------------");
    console.log("Parsing fresh runtime CSV execution data metrics...");
    console.log("--------------------------------------------------");
    
    // Corrected to match your data directory structure exactly
    const csvPath = path.join(__dirname, '../data/moveinsync_12months_low_ratings.csv');
    
    if (!fs.existsSync(csvPath)) {
        console.error(`❌ Execution error: Ingest target CSV metrics table missing at:\n   ${csvPath}`);
        console.log("\n💡 Path Guidance: Verify that 'moveinsync_12months_low_ratings.csv' is placed inside your 'data' folder.");
        process.exit(1);
    }

    const fileContent = fs.readFileSync(csvPath, 'utf8');
    const rows = fileContent.split('\n').filter(row => row.trim() !== '');
    
    const headers = rows[0].split(',');
    
    // Find index markers dynamically
    const categoryIndex = headers.indexOf('PrimaryCategory');

    let totalNegatives = rows.length - 1;
    let counts = { 'Login/OTP': 0, 'GPS/Tracking': 0, 'App Stability': 0, 'Operations/Driver': 0, 'Other Issues': 0 };

    // Compute live category densities
    for (let i = 1; i < rows.length; i++) {
        const columns = rows[i].split(',');
        const category = columns[categoryIndex] ? columns[categoryIndex].trim() : '';
        if (counts[category] !== undefined) {
            counts[category]++;
        } else {
            counts['Other Issues']++;
        }
    }

    console.log("\n📊 --- Live Fleet Telemetry Analytics ---");
    let thresholdViolationDetected = false;
    let alertReasons = [];

    Object.keys(counts).forEach(key => {
        const percentage = ((counts[key] / totalNegatives) * 100);
        console.log(`-> ${key}: ${percentage.toFixed(1)}% (${counts[key]} rows)`);

        if (key !== 'Other Issues' && percentage >= CRITICAL_ALERT_THRESHOLD_PCT) {
            thresholdViolationDetected = true;
            alertReasons.push(`${key} (${percentage.toFixed(1)}%)`);
        }
    });

    // Conditional Report Trigger Evaluation
    if (thresholdViolationDetected) {
        console.log(`\n🚨 [ALERT] Operational threshold breach detected for: ${alertReasons.join(', ')}`);
        console.log("Compiling markdown summary asset artifacts...");

        const reportTemplate = `# 🚨 MOVEINSYNC CRITICAL INCIDENT REPORT
Generated automatically on: ${new Date().toISOString()}
Target Analysis Condition: Outbound Failure Group >= ${CRITICAL_ALERT_THRESHOLD_PCT}%

## 📊 Telemetry Breach Vector Breakdown
* **Primary Violation Drivers:** ${alertReasons.join(', ')}
* **Total Negative Ingestion Dataset Volume:** ${totalNegatives} entries analyzed.

## 📈 Categorical Distribution Metrics
* **Login/OTP Failures:** ${((counts['Login/OTP']/totalNegatives)*100).toFixed(1)}%
* **GPS/Tracking Latency:** ${((counts['GPS/Tracking']/totalNegatives)*100).toFixed(1)}%
* **App Core Crash Instability:** ${((counts['App Stability']/totalNegatives)*100).toFixed(1)}%
* **Operations/Driver Logistics:** ${((counts['Operations/Driver']/totalNegatives)*100).toFixed(1)}%

## 🛡️ Next-Day Action Directive
This artifact indicates a significant regression spike in production user sentiment. Please inspect recent software version deployments immediately.`;

        fs.writeFileSync(path.join(__dirname, '../data/CRITICAL_ALERT_REPORT.md'), reportTemplate);
        console.log("📝 Report generated successfully as 'data/CRITICAL_ALERT_REPORT.md'.");
        
        if (process.env.GITHUB_OUTPUT) {
            fs.appendFileSync(process.env.GITHUB_OUTPUT, "trigger_pdf_build=true\n");
        }
    } else {
        console.log("\n✅ [SUCCESS] Fleet systems operating smoothly inside metric boundaries.");
        if (process.env.GITHUB_OUTPUT) {
            fs.appendFileSync(process.env.GITHUB_OUTPUT, "trigger_pdf_build=false\n");
        }
    }
}

generateAutomatedReport();
