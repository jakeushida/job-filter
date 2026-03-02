/**
 * Google Apps Script - Webhook for LinkedIn Job Auto-Filter
 * 
 * Instructions:
 * 1. Open a new Google Sheet (sheets.new).
 * 2. Go to Extensions > Apps Script.
 * 3. Delete any code in Code.gs and paste this entire file.
 * 4. Save the project.
 * 5. Run the `setup()` function once manually to create the headers.
 * 6. Click "Deploy" > "New deployment" at the top right.
 * 7. Select type: "Web app".
 * 8. Execute as: "Me" (your email).
 * 9. Who has access: "Anyone".
 * 10. Click "Deploy" and authorize the script.
 * 11. Copy the "Web app URL" and paste it into the Chrome Extension popup.
 */

function setup() {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getActiveSheet();
    sheet.setName("Matched");

    // Set headers if the sheet is empty
    if (sheet.getLastRow() === 0) {
        sheet.appendRow([
            "Timestamp",
            "Job Title",
            "Company",
            "Location",
            "URL",
            "Eligible?",
            "Fit Score",
            "Readiness Score",
            "Strengths Alignment",
            "Critical Gaps"
        ]);
        // Format headers
        sheet.getRange(1, 1, 1, 10).setFontWeight("bold").setBackground("#e0e0e0");
        sheet.setFrozenRows(1);
    }

    // Set up Unmatched sheet
    let unmatchedSheet = spreadsheet.getSheetByName("Unmatched");
    if (!unmatchedSheet) {
        unmatchedSheet = spreadsheet.insertSheet("Unmatched");
        unmatchedSheet.appendRow([
            "Timestamp",
            "Job Title",
            "Company",
            "Location",
            "URL",
            "Eligible?",
            "Decision",
            "Reason Rejected"
        ]);
        unmatchedSheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#e0e0e0");
        unmatchedSheet.setFrozenRows(1);
    }
}

function doPost(e) {
    try {
        // Chrome extension sends JSON as text/plain to avoid CORS preflight
        const payload = JSON.parse(e.postData.contents);

        const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
        const timestamp = new Date();

        const isMatched = payload.decision === "SAVE";

        if (isMatched) {
            let sheet = spreadsheet.getSheetByName("Matched") || spreadsheet.getActiveSheet();
            sheet.appendRow([
                timestamp,
                payload.job_title || "Unknown",
                payload.company_name || "Unknown",
                payload.location || "Unknown",
                payload.url || "",
                payload.is_eligible !== undefined ? payload.is_eligible : "Unknown",
                payload.fit_score || 0,
                payload.readiness_score || 0,
                payload.strengths_alignment || "None",
                payload.critical_gaps || "None"
            ]);
        } else {
            let sheet = spreadsheet.getSheetByName("Unmatched");
            if (!sheet) sheet = spreadsheet.insertSheet("Unmatched");

            sheet.appendRow([
                timestamp,
                payload.job_title || "Unknown",
                payload.company_name || "Unknown",
                payload.location || "Unknown",
                payload.url || "",
                payload.is_eligible !== undefined ? payload.is_eligible : "Unknown",
                payload.decision || "REJECT",
                payload.ineligibility_reason || payload.critical_gaps || "N/A"
            ]);
        }

        // Send an email notification only if the toggle is ON and the job is eligible
        if (payload.send_email && payload.is_eligible === "Yes") {
            const emailAddress = Session.getActiveUser().getEmail();
            const subject = `Eligible Job Match: ${payload.job_title} at ${payload.company_name}`;
            const body = `
Good news! The Job Auto-Filter found an eligible match.

Job Title: ${payload.job_title}
Company: ${payload.company_name}
Location: ${payload.location}

Eligible?: ${payload.is_eligible}
Fit Score: ${payload.fit_score}/100
Readiness Score: ${payload.readiness_score}/100

URL: ${payload.url}

Strengths:
${payload.strengths_alignment}

Gaps:
${payload.critical_gaps}
            `;

            MailApp.sendEmail(emailAddress, subject, body);
        }

        return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);

    } catch (error) {
        return ContentService.createTextOutput("Error: " + error.toString()).setMimeType(ContentService.MimeType.TEXT);
    }
}

// Handle GET requests (e.g. if you open the URL in your browser directly)
function doGet(e) {
    try {
        const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
        const sheets = spreadsheet.getSheets();
        const processedJobs = [];

        for (const sheet of sheets) {
            const sheetName = sheet.getName();
            // Pull from Matched, Unmatched, or old sheet names
            if (sheetName === "Matched" || sheetName === "Unmatched" || sheetName === "Sheet1") {
                const data = sheet.getDataRange().getValues();
                // Start from row 1 to skip headers
                for (let i = 1; i < data.length; i++) {
                    const row = data[i];
                    processedJobs.push({
                        title: String(row[1] || "").toLowerCase().trim(),
                        company: String(row[2] || "").toLowerCase().trim(),
                        url: String(row[4] || "").toLowerCase().trim()
                    });
                }
            }
        }
        return ContentService.createTextOutput(JSON.stringify({ status: "success", jobs: processedJobs })).setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
    }
}
