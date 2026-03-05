document.addEventListener('DOMContentLoaded', () => {
    const apiProviderSelect = document.getElementById('apiProvider');
    const apiKeyInput = document.getElementById('apiKey');
    const anthropicApiKeyInput = document.getElementById('anthropicApiKey');
    const geminiKeyGroup = document.getElementById('geminiKeyGroup');
    const anthropicKeyGroup = document.getElementById('anthropicKeyGroup');
    const webhookUrlInput = document.getElementById('webhookUrl');
    const negativeKeywordsInput = document.getElementById('negativeKeywords');
    const profileInput = document.getElementById('profile');
    const resumeInput = document.getElementById('resume');
    const experienceInput = document.getElementById('experience');
    const emailToggle = document.getElementById('emailToggle');
    const saveBtn = document.getElementById('saveBtn');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const loadProfileBtn = document.getElementById('loadProfileBtn');
    const loadSkillsBtn = document.getElementById('loadSkillsBtn');
    const loadExperienceBtn = document.getElementById('loadExperienceBtn');
    const statusDiv = document.getElementById('status');
    const progressText = document.getElementById('progressText');
    const matchesText = document.getElementById('matchesText');
    const skippedText = document.getElementById('skippedText');

    let bgPort = null;

    // Toggle visibility based on provider
    function updateProviderVisibility() {
        if (apiProviderSelect.value === 'anthropic') {
            geminiKeyGroup.style.display = 'none';
            anthropicKeyGroup.style.display = 'block';
        } else {
            geminiKeyGroup.style.display = 'block';
            anthropicKeyGroup.style.display = 'none';
        }
    }
    apiProviderSelect.addEventListener('change', updateProviderVisibility);

    // Load saved settings
    chrome.storage.local.get(['apiProvider', 'apiKey', 'anthropicApiKey', 'geminiModelId', 'webhookUrl', 'negativeKeywords', 'profile', 'resume', 'experience', 'sendEmails', 'isRunning', 'stats', 'lastStatus'], (result) => {
        if (result.apiProvider) apiProviderSelect.value = result.apiProvider;
        if (result.apiKey) apiKeyInput.value = result.apiKey;
        if (result.anthropicApiKey) anthropicApiKeyInput.value = result.anthropicApiKey;
        if (result.geminiModelId) {
            document.getElementById('geminiModelId').value = result.geminiModelId;
        } else {
            document.getElementById('geminiModelId').value = "gemini-2.5-flash-lite";
        }
        if (result.webhookUrl) webhookUrlInput.value = result.webhookUrl;
        if (result.negativeKeywords !== undefined) {
            negativeKeywordsInput.value = result.negativeKeywords;
        } else {
            negativeKeywordsInput.value = "graduate, postdoctoral, masters, phd"; // Default value
        }
        if (result.profile) profileInput.value = result.profile;
        if (result.resume) resumeInput.value = result.resume;
        if (result.experience) experienceInput.value = result.experience;
        if (result.sendEmails !== undefined) emailToggle.checked = result.sendEmails;

        updateProviderVisibility();

        if (result.isRunning) {
            setRunningState(true);
        }

        if (result.stats) {
            updateProgressText(result.stats);
        }

        if (result.lastStatus) {
            showStatus(result.lastStatus.text, result.lastStatus.isError);
        } else if (result.isRunning) {
            showStatus('Running evaluation...', false);
        }
    });

    saveBtn.addEventListener('click', () => {
        chrome.storage.local.set({
            apiProvider: apiProviderSelect.value,
            apiKey: apiKeyInput.value.trim(),
            anthropicApiKey: anthropicApiKeyInput.value.trim(),
            geminiModelId: document.getElementById('geminiModelId').value,
            webhookUrl: webhookUrlInput.value.trim(),
            negativeKeywords: negativeKeywordsInput.value.trim(),
            profile: profileInput.value.trim(),
            resume: resumeInput.value.trim(),
            experience: experienceInput.value.trim(),
            sendEmails: emailToggle.checked
        }, () => {
            showStatus('Settings saved!', false);
        });
    });

    async function loadResource(filename, inputElement) {
        try {
            const url = chrome.runtime.getURL(filename);
            const response = await fetch(url);
            if (response.ok) {
                const text = await response.text();
                inputElement.value = text;
                showStatus(`Loaded ${filename}`, false);
            } else {
                showStatus(`Could not find ${filename}`, true);
            }
        } catch (e) {
            showStatus(`Error loading ${filename}`, true);
        }
    }

    loadProfileBtn.addEventListener('click', () => loadResource('profile.md', profileInput));
    loadSkillsBtn.addEventListener('click', () => loadResource('skills.md', resumeInput));
    loadExperienceBtn.addEventListener('click', () => loadResource('resume.md', experienceInput));

    startBtn.addEventListener('click', async () => {
        if (apiProviderSelect.value === 'gemini' && !apiKeyInput.value.trim()) {
            showStatus('Please enter a Gemini API Key', true);
            return;
        }
        if (apiProviderSelect.value === 'anthropic' && !anthropicApiKeyInput.value.trim()) {
            showStatus('Please enter an Anthropic API Key', true);
            return;
        }

        // Must run on LinkedIn Jobs page
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.url.includes('linkedin.com/jobs')) {
            showStatus('Navigate to a LinkedIn Jobs page first', true);
            return;
        }

        chrome.storage.local.set({ isRunning: true, stats: { processed: 0, total: 0, matches: 0, skipped: 0 }, lastStatus: { text: 'Starting...', isError: false } }, () => {
            setRunningState(true);
            updateProgressText({ processed: 0, total: 0, matches: 0 });
            chrome.runtime.sendMessage({ action: 'START_EVALUATION', tabId: tab.id });
        });
    });

    stopBtn.addEventListener('click', () => {
        chrome.storage.local.set({ isRunning: false, lastStatus: { text: 'Evaluation stopped', isError: false } }, () => {
            setRunningState(false);
            chrome.runtime.sendMessage({ action: 'STOP_EVALUATION' });
            showStatus('Evaluation stopped', false);
        });
    });

    // Listen for state/progress updates from the background script
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'UPDATE_PROGRESS') {
            updateProgressText(message.stats);
        } else if (message.action === 'EVALUATION_COMPLETE') {
            setRunningState(false);
            showStatus('Evaluation complete!', false);
            chrome.storage.local.set({ isRunning: false });
        } else if (message.action === 'EVALUATION_ERROR') {
            setRunningState(false);
            showStatus('Error: ' + message.error, true);
            chrome.storage.local.set({ isRunning: false });
        } else if (message.action === 'STATUS_MSG') {
            showStatus(message.text, message.isError || false);
        }
    });

    function showStatus(msg, isError = false) {
        statusDiv.textContent = msg;
        statusDiv.style.color = isError ? '#ef4444' : '#059669';
    }

    function updateProgressText(stats) {
        progressText.textContent = `Processed: ${stats.processed}${stats.total ? '/' + stats.total : ''}`;
        matchesText.textContent = `Matches: ${stats.matches}`;
        if (skippedText && stats.skipped !== undefined) {
            skippedText.textContent = `Skipped: ${stats.skipped}`;
        }
    }

    function setRunningState(isRunning) {
        if (isRunning) {
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
        } else {
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
        }
    }
});
