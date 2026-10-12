const gplayModule = require('google-play-scraper');
const gplay = gplayModule.default || gplayModule;
const fs = require('fs');
const fastcsv = require('fast-csv');

// Human-mimicking sleep utility to dodge automated firewall flags
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getSixMonthsReviews() {
    try {
        console.log("==================================================");
        console.log("Starting resilient 6-month historical scrape...");
        console.log("==================================================");

        const targetDate = new Date();
        targetDate.setMonth(targetDate.getMonth() - 6);
        console.log(`Target Cutoff Date: ${targetDate.toDateString()}`);

        let allReviews = [];
        let nextToken = null;
        let pageCount = 1;
        let consecutiveOldBatches = 0;

        // Loop handles defensive pagination control safely
        while (pageCount <= 60) {
            console.log(`Fetching review page ${pageCount}...`);
            
            let response;
            try {
                response = await gplay.reviews({
                    appId: 'com.moveinsync.ets',
                    lang: 'en',
                    country: 'in',
                    sort: gplay.sort.NEWEST,
                    paginate: true,
                    nextPaginationToken: nextToken
                });
            } catch (networkErr) {
                console.warn(`[Warning] Transient network glitch on page ${pageCount}. Retrying in 3s...`);
                await sleep(3000);
                // Simple single-retry fallback mechanism
                response = await gplay.reviews({ appId: 'com.moveinsync.ets', lang: 'en', country: 'in', sort: gplay.sort.NEWEST, paginate: true, nextPaginationToken: nextToken });
            }

            const currentBatch = response.data;
            
            if (!currentBatch || currentBatch.length === 0) {
                console.log("No more public review segments returned from Play Store.");
                break;
            }

            allReviews = allReviews.concat(currentBatch);

            // Access the tail end timestamp of current payload segment 
            const oldestInBatch = new Date(currentBatch[currentBatch.length - 1].date);
            console.log(`-> Oldest review timestamp in batch ${pageCount}: ${oldestInBatch.toDateString()}`);

            // Defensive Check: Break only if the entire page batch systematically falls past the cutoff.
            // This prevents premature exiting caused by occasional unsorted reviews.
            const isEntireBatchPastCutoff = currentBatch.every(r => new Date(r.date) < targetDate);
            if (isEntireBatchPastCutoff) {
                consecutiveOldBatches++;
                if (consecutiveOldBatches >= 2) { 
                    console.log("Confirmed target baseline timeline threshold reached.");
                    break;
                }
            } else {
                consecutiveOldBatches = 0;
            }

            nextToken = response.nextPaginationToken; 
            if (!nextToken) {
                console.log("No further pagination token markers found.");
                break;
            }

            pageCount++;
            // Throttling: 1.5-second sleep interval avoids 429 rate-limiting blocks
            await sleep(1500); 
        }

        // Post-Fetch Filter: Ensure precise timestamp filtering across all collected rows
        const validReviews = allReviews.filter(r => new Date(r.date) >= targetDate);
        console.log(`\nTotal valid reviews collected within 6 months: ${validReviews.length}`);

        // Isolate low-rated logs (1-3 Stars)
        const negativeReviews = validReviews.filter(review => review.score <= 3);
        console.log(`Filtered down to ${negativeReviews.length} negative entries.`);

        const cleanData = negativeReviews.map(r => ({
            Date: r.date,
            UserName: r.userName,
            Rating: r.score,
            ReviewText: r.text,
            AppVersion: r.version || 'Unknown'
        }));

        if (cleanData.length === 0) {
            console.log("Scraping execution halted: No matching low-rating items found.");
            return;
        }

        // Wrap stream in a Promise to prevent process termination before disk writing completes
        const pipelineWrite = () => new Promise((resolve, reject) => {
            const ws = fs.createWriteStream('moveinsync_6months_low_ratings.csv');
            fastcsv.write(cleanData, { headers: true })
                .pipe(ws)
                .on('finish', () => {
                    console.log("Success! Saved cleanly to 'moveinsync_6months_low_ratings.csv'.");
                    resolve();
                })
                .on('error', (err) => reject(err));
        });

        await pipelineWrite();

    } catch (error) {
        console.error("Critical execution breakdown encountered during routine:", error);
    }
}

getSixMonthsReviews();
