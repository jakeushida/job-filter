let isRunning = false;

// Listen for messages from the popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PING') {
        sendResponse({ status: 'ok' });
    } else if (request.action === 'START_CARDS_PROCESSING') {
        isRunning = true;
        processJobs(request.jobIndex || 0);
    } else if (request.action === 'STOP_EVALUATION') {
        isRunning = false;
    } else if (request.action === 'WAIT') {
        setTimeout(() => {
            sendResponse({ status: 'ok' });
        }, request.ms || 1000);
        return true; // Keeps the message channel open for async response
    }
});

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sanitizeHTML(node) {
    const clone = node.cloneNode(true);

    // Remove unnecessary tags
    const tagsToRemove = ['script', 'style', 'svg', 'path', 'img', 'noscript', 'meta', 'link'];
    tagsToRemove.forEach(tag => {
        const elements = clone.querySelectorAll(tag);
        elements.forEach(el => el.remove());
    });

    // Remove all classes and ids to preserve tokens, only keep raw structure and text
    const allElements = clone.querySelectorAll('*');
    allElements.forEach(el => {
        const attrs = el.attributes;
        const toRemove = [];
        for (let i = 0; i < attrs.length; i++) {
            if (attrs[i].name !== 'href') { // Keep href for links if necessary, otherwise strip
                toRemove.push(attrs[i].name);
            }
        }
        toRemove.forEach(attr => el.removeAttribute(attr));
    });

    return clone.innerHTML.replace(/\s+/g, ' ').trim();
}

async function processJobs(startIndex) {
    if (!isRunning) return;

    // Find the job cards on the left navigation
    let jobCards = document.querySelectorAll('.job-card-container, .scaffold-layout__list-item [data-job-id], .jobs-search-results__list-item');

    if (jobCards.length === 0) {
        chrome.runtime.sendMessage({
            action: 'EVALUATION_ERROR',
            error: 'Could not find any job cards on the page. Make sure you are on a LinkedIn jobs search page with the cards list active.'
        });
        return;
    }

    // If we hit the end of currently loaded jobs, try to scroll down the list container to force lazy-loading
    if (startIndex >= jobCards.length) {
        const listContainer = document.querySelector('.jobs-search-results-list, .scaffold-layout__list');
        if (listContainer) {
            chrome.runtime.sendMessage({ action: 'STATUS_MSG', text: 'Loading more jobs...' });

            // Scroll to the bottom of the container
            listContainer.scrollTop = listContainer.scrollHeight;

            // Wait for LinkedIn to fetch new jobs
            await delay(2500);

            // Re-query the job cards
            jobCards = document.querySelectorAll('.job-card-container, .scaffold-layout__list-item [data-job-id], .jobs-search-results__list-item');
        }
    }

    const totalJobs = jobCards.length;

    if (startIndex >= totalJobs) {
        chrome.runtime.sendMessage({
            action: 'STATUS_MSG',
            text: 'All visible jobs processed.'
        });
        chrome.runtime.sendMessage({ action: 'EVALUATION_COMPLETE' });
        return;
    }

    const card = jobCards[startIndex];

    // Send progress to UI
    chrome.runtime.sendMessage({
        action: 'STATUS_MSG',
        text: `Processing job ${startIndex + 1} of ${totalJobs}`
    });

    // Scroll card into view and click it
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Try to find a clickable element inside, or click the card itself
    const clickable = card.querySelector('a') || card;
    clickable.click();

    // Wait for the right pane to lazy load the content. 
    // Random human-like delay between 1.5s and 3s
    await delay(getRandomDelay(2000, 3500));

    if (!isRunning) return;

    // Extract details from the right pane
    const rightPane = document.querySelector('.jobs-search__job-details--container, #job-details, .job-view-layout');

    if (!rightPane) {
        chrome.runtime.sendMessage({
            action: 'STATUS_MSG',
            text: `Skipping job ${startIndex + 1}: Could not find description pane.`,
            isError: true
        });
        // Skip to next
        await delay(getRandomDelay(1000, 2000));
        processJobs(startIndex + 1);
        return;
    }

    let title = '';
    let company = '';
    const titleEl = document.querySelector('.job-details-jobs-unified-top-card__job-title, h1');
    const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name');
    if (titleEl) title = titleEl.innerText.trim();
    if (companyEl) company = companyEl.innerText.trim();

    const sanitizedHTML = sanitizeHTML(rightPane);

    const jobData = {
        title: title,
        company: company,
        url: window.location.href, // This URL might update dynamically when the card is clicked
        htmlContent: sanitizedHTML
    };

    // Send payload to background script to evaluate via Gemini API
    chrome.runtime.sendMessage({
        action: 'EVALUATE_JOB',
        jobData: jobData,
        jobIndex: startIndex,
        totalJobs: totalJobs
    });
}
