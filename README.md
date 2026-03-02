# LinkedIn Job Auto-Filter Extension

An automated Chrome extension that helps you filter through LinkedIn job listings using LLMs (Gemini or Anthropic Claude). It evaluates job descriptions against your personal profile, skills, and experience, scores them, and logs the results to a Google Sheet.

## Features

- **Automated Processing**: Automatically navigates through LinkedIn job search results on the left pane and extracts job descriptions.
- **AI Evaluation**: Uses Gemini (Free Tier) or Anthropic (Claude) to evaluate job descriptions based on:
  - **Eligibility**: Strict Go/No-Go check based on your demographics and visa status.
  - **Fit Score**: How well the job description aligns with your target skills.
  - **Readiness Score**: How likely you are to get the job based on your past experiences.
- **Negative Keyword Pre-filtering**: Instantly skips and rejects jobs with specific keywords (e.g., "graduate", "intern") to save API tokens and time.
- **Google Sheets Integration**: Logs all evaluated jobs into "Matched" or "Unmatched" sheets via a Google Apps Script webhook, ensuring you never evaluate the same job twice.

## Setup Instructions

### 1. Configure the AI Prompts

You need to provide the AI with your personal information. Create the following three files in the root of the extension directory. **Do not share these files publicly!** (They are already included in the `.gitignore`):

*   `profile.md`: Your demographics, visa status, major, etc. (Used for Eligibility).
*   `skills.md`: The specific technical and soft skills you are targeting (Used for Fit Score).
*   `resume.md` (or `experience.md`): Your past work experience and projects (Used for Readiness Score).

### 2. Set Up the Google Apps Script Webhook

This script acts as the backend database for your extension, saving jobs to a Google Sheet.

1.  Open a new Google Sheet (go to [sheets.new](https://sheets.new)).
2.  Go to **Extensions > Apps Script**.
3.  Delete any existing code and copy-paste the entire contents of the `google_apps_script.js` file from this repository into the editor.
4.  Save the project.
5.  In the Apps Script editor, select the `setup` function from the dropdown in the toolbar and click **Run**. It will ask for permissions to access your Google Sheet; approve them. This will format your sheet and create the "Matched" and "Unmatched" tabs.
6.  Click **Deploy > New deployment** at the top right.
7.  Click the gear icon next to "Select type" and choose **Web app**.
8.  Set "Execute as" to **Me** (your email).
9.  Set "Who has access" to **Anyone**.
10. Click **Deploy**.
11. Copy the **Web app URL**. You will need this for the extension settings.

### 3. Install the Chrome Extension

1.  Open Google Chrome and navigate to `chrome://extensions/`.
2.  Enable **Developer mode** using the toggle in the top right corner.
3.  Click the **Load unpacked** button in the top left corner.
4.  Select the folder containing this repository's code.
5.  Pin the extension to your toolbar for easy access!

### 4. Configure the Extension

1.  Click the extension icon in your Chrome toolbar.
2.  Select your preferred **AI Provider** (Gemini or Anthropic Claude).
3.  Enter your corresponding **API Key**.
4.  Paste the **Google Apps Script Webhook URL** you copied in Step 2.
5.  (Optional) Adjust the **Negative Keywords** to auto-reject specific job titles.
6.  Click **Save Settings**.

## Usage

1.  Go to LinkedIn and perform a job search (e.g., "Software Engineer").
2.  Click on the extension icon to open the popup.
3.  Click **Start Evaluation**.
4.  The extension will begin clicking through the jobs on the left pane, extracting the descriptions, evaluating them with the AI, and sending the results to your Google Sheet.
5.  **Do not navigate away from the tab or close the popup** while the evaluation is running, as it may interrupt the sequence.
