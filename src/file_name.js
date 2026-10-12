const gplayModule = require('google-play-scraper');
const gplay = gplayModule.default || gplayModule;
const fs = require('fs');
const fastcsv = require('fast-csv');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Resilient wrapper around the google-play-scraper API call.
 * Implements exponential backoff retry logic to bypass ECONNRESET / Rate Limits.
 */
async function fetchReviewsWithRetry(options, maxRetries = 4) {
    let attempt = 0;
    let baseDelay = 3000; // Start with a 3-second delay on error

    while (attempt < maxRetries) {
        try {
            return await gplay.reviews(options);
        } catch (error) {
            attempt++;
            const isNetworkReset = error.message && error.message.includes('ECONNRESET');
            
            console.warn(`\n[Network Alert] Page fetch failed on attempt ${attempt}/${maxRetries}. Reason: ${error.message || error}`);
            
            if (attempt >= maxRetries) {
                throw new Error(`Critical: Maximum retry threshold reached. Failed to recover from network block.`);
            }

            // Exponential backoff calculation with a bit of random noise (jitter) to dodge firewalls
            const jitter = Math.random() * 1000;
            const backoffTime = (baseDelay * Math.pow(2, attempt)) + jitter;
            
            console.log(`Pausing execution for ${((backoffTime)/1000).toFixed(2)}s before attempting dynamic reconnection...`);
            await sleep(backoffTime);
        }
    }
}

async function analyzeTwelveMonthsReviews() {
    try {
        console.log("--------------------------------------------------");
        console.log("Starting MoveInSync 12-Month Historical Analytics...");
        console.log("--------------------------------------------------");

        const targetDate = new Date();
        targetDate.setMonth(targetDate.getMonth() - 12);
        console.log(`Target Cutoff Date: ${targetDate.toDateString()}`);

        let allCollectedReviews = [];
        let nextToken = null;
        let pageCount = 1;
        let consecutiveOldBatches = 0;

        while (pageCount <= 150) {
            console.log(`Fetching page ${pageCount}...`);
            
            // Replaced raw gplay call with our resilient retry engine
            const response = await fetchReviewsWithRetry({
                appId: 'com.moveinsync.ets',
                lang: 'en',
                country: 'in',
                sort: gplay.sort.NEWEST,
                paginate: true,
                nextPaginationToken: nextToken
            });

            const currentBatch = response.data;
            
            if (!currentBatch || currentBatch.length === 0) {
                console.log("No further public reviews found.");
                break;
            }

            allCollectedReviews = allCollectedReviews.concat(currentBatch);
            
            const oldestInBatch = new Date(currentBatch[currentBatch.length - 1].date);
            console.log(`-> Oldest review in page ${pageCount}: ${oldestInBatch.toDateString()}`);

            const allItemsInBatchAreOld = currentBatch.every(r => new Date(r.date) < targetDate);
            if (allItemsInBatchAreOld) {
                consecutiveOldBatches++;
                if (consecutiveOldBatches >= 2) { 
                    console.log("Safely hit the historical timeline depth limit.");
                    break;
                }
            } else {
                consecutiveOldBatches = 0;
            }

            nextToken = response.nextPaginationToken; 
            if (!nextToken) {
                console.log("Reached final page token.");
                break;
            }
            
            pageCount++;
            // Baseline human throttle interval
            await sleep(1500); 
        }

        const validTimeframeReviews = allCollectedReviews.filter(r => new Date(r.date) >= targetDate);
        console.log(`\nTotal reviews collected within 12 months: ${validTimeframeReviews.length}`);

        const negativeReviews = validTimeframeReviews.filter(review => review.score <= 3);
        const totalNegatives = negativeReviews.length;
        console.log(`Filtered down to ${totalNegatives} negative entries (1-3 stars).\n`);

        if (totalNegatives === 0) {
            console.log("No negative reviews found matching parameters.");
            return;
        }

        const metrics = {
            loginOtp: 0,
            trackingGps: 0,
            appCrashStability: 0,
            operationalDriver: 0,
            otherIssues: 0
        };

        const cleanData = negativeReviews.map(r => {
            const text = (r.text || '').toLowerCase();
            let primaryCategory = 'Other Issues';

            if (text.includes('otp') || text.includes('login') || text.includes('sign in') || text.includes('password') || text.includes('register')) {
                metrics.loginOtp++;
                primaryCategory = 'Login/OTP';
            } else if (text.includes('map') || text.includes('gps') || text.includes('track') || text.includes('location') || text.includes('lag')) {
                metrics.trackingGps++;
                primaryCategory = 'GPS/Tracking';
            } else if (text.includes('crash') || text.includes('blank') || text.includes('freeze') || text.includes('glitch') || text.includes('bug')) {
                metrics.appCrashStability++;
                primaryCategory = 'App Stability';
            } else if (text.includes('driver') || text.includes('late') || text.includes('cancel') || text.includes('cab') || text.includes('shuttle')) {
                metrics.operationalDriver++;
                primaryCategory = 'Operations/Driver';
            } else {
                metrics.otherIssues++;
            }

            return {
                Date: r.date,
                UserName: r.userName,
                Rating: r.score,
                PrimaryCategory: primaryCategory,
                ReviewText: r.text,
                AppVersion: r.version || 'Unknown',
                ThumbsUpCount: r.thumbsUp
            };
        });

        console.log("==================================================");
        console.log("    SUMMARY ANALYSIS FOR YOUR STRATEGY REPORT     ");
        console.log("==================================================");
        console.log(`Total Negative Reviews Analysed: ${totalNegatives}`);
        console.log(`1. Login/OTP Issues: ${metrics.loginOtp} reviews (${((metrics.loginOtp/totalNegatives)*100).toFixed(1)}%)`);
        console.log(`2. GPS/Tracking/Maps: ${metrics.trackingGps} reviews (${((metrics.trackingGps/totalNegatives)*100).toFixed(1)}%)`);
        console.log(`3. App Crashes/Bugs: ${metrics.appCrashStability} reviews (${((metrics.appCrashStability/totalNegatives)*100).toFixed(1)}%)`);
        console.log(`4. Operational/Driver: ${metrics.operationalDriver} reviews (${((metrics.operationalDriver/totalNegatives)*100).toFixed(1)}%)`);
        console.log(`5. Miscellaneous Unmatched: ${metrics.otherIssues} reviews (${((metrics.otherIssues/totalNegatives)*100).toFixed(1)}%)`);
        console.log("==================================================");

        const writeCSV = () => new Promise((resolve, reject) => {
            const ws = fs.createWriteStream('moveinsync_12months_low_ratings.csv');
            fastcsv.write(cleanData, { headers: true })
                .pipe(ws)
                .on('finish', () => {
                    console.log("\nCSV Generation Complete! File saved as 'moveinsync_12months_low_ratings.csv'.");
                    resolve();
                })
                .on('error', (err) => reject(err));
        });

        await writeCSV();

    } catch (error) {
        console.error("Scraping execution stopped unexpectedly due to error:", error);
    }
}

analyzeTwelveMonthsReviews();
