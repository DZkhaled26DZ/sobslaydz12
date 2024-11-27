const API_KEY = 'nc3cvP0d3LZzL9AIIgQQsjU6MKN8g5oanFkiAo4BdykbaOlce3HsTbWB3mPCoL8z';
const BINANCE_API_URL = 'https://api.binance.com/api/v3';

let analysisRunning = false;
let soundEnabled = true;
let volume = 50;

// Audio context for notifications
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    initializeControls();
    updateAlgeriaTime();
    setInterval(updateAlgeriaTime, 1000);
    
    // Set default tail direction
    document.getElementById('tailUp').checked = true;
});

// Initialize all controls and event listeners
function initializeControls() {
    const startButton = document.getElementById('startAnalysis');
    const refreshButton = document.getElementById('refreshData');
    const resetButton = document.getElementById('resetSettings');
    const soundToggle = document.getElementById('soundToggle');
    const volumeControl = document.getElementById('volumeControl');

    startButton.addEventListener('click', toggleAnalysis);
    refreshButton.addEventListener('click', refreshData);
    resetButton.addEventListener('click', resetSettings);
    soundToggle.addEventListener('change', toggleSound);
    volumeControl.addEventListener('input', updateVolume);

    // Initialize sort buttons
    document.querySelectorAll('.sort-btn').forEach(button => {
        button.addEventListener('click', () => sortResults(button.dataset.sort));
    });
}

// Update Algeria time
function updateAlgeriaTime() {
    const algeriaTime = new Date().toLocaleTimeString('en-US', {
        timeZone: 'Africa/Algiers',
        hour12: false
    });
    document.getElementById('algeriaTime').textContent = algeriaTime;
}

// Toggle analysis state
async function toggleAnalysis() {
    const button = document.getElementById('startAnalysis');
    const selectedTailDirection = document.querySelector('input[name="tailDirection"]:checked');
    
    if (!selectedTailDirection) {
        alert('الرجاء اختيار اتجاه الذيل قبل بدء التحليل');
        return;
    }
    
    analysisRunning = !analysisRunning;
    
    if (analysisRunning) {
        button.textContent = 'إيقاف التحليل';
        button.style.backgroundColor = 'var(--danger-color)';
        disableControls(true);
        await startAnalysis();
    } else {
        button.textContent = 'بدء التحليل';
        button.style.backgroundColor = 'var(--primary-color)';
        disableControls(false);
    }
}

// Start the analysis process
async function startAnalysis() {
    const timeframe = document.getElementById('timeframe').value;
    const tailDirection = document.querySelector('input[name="tailDirection"]:checked').value;
    console.log('Starting analysis with timeframe:', timeframe, 'tail direction:', tailDirection);

    while (analysisRunning) {
        try {
            const symbols = await getUSDTSymbols();
            console.log('Found', symbols.length, 'USDT pairs');
            
            for (const symbol of symbols) {
                if (!analysisRunning) break;
                
                const candles = await getKlines(symbol, timeframe);
                if (!candles || candles.length < 5) {
                    console.log('Invalid candles data for', symbol);
                    continue;
                }
                
                const analysis = analyzeCandles(candles, tailDirection);
                if (analysis.matches) {
                    console.log('Pattern found for', symbol, analysis);
                    updateResults(symbol, analysis);
                    if (soundEnabled) playNotification();
                }
                
                // Add small delay between requests to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            // Wait before starting next analysis cycle
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error('Analysis error:', error);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Get all USDT trading pairs
async function getUSDTSymbols() {
    try {
        const response = await fetch(`${BINANCE_API_URL}/exchangeInfo`);
        if (!response.ok) {
            throw new Error('Failed to fetch exchange info');
        }
        const data = await response.json();
        return data.symbols
            .filter(symbol => symbol.quoteAsset === 'USDT' && symbol.status === 'TRADING')
            .map(symbol => symbol.symbol);
    } catch (error) {
        console.error('Error fetching symbols:', error);
        return [];
    }
}

// Get kline (candlestick) data
async function getKlines(symbol, interval) {
    try {
        const response = await fetch(
            `${BINANCE_API_URL}/klines?symbol=${symbol}&interval=${interval}&limit=5`
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch klines for ${symbol}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching klines for ${symbol}:`, error);
        return null;
    }
}

// Analyze candlestick patterns
function analyzeCandles(candles, tailDirection) {
    if (candles.length < 5) return { matches: false };

    const lastFiveCandles = candles.slice(-5);
    const redCandles = lastFiveCandles.slice(0, 4);
    const greenCandle = lastFiveCandles[4];

    // Check for four red candles with significant body
    const hasRedCandles = redCandles.every(candle => {
        const open = parseFloat(candle[1]);
        const close = parseFloat(candle[4]);
        const bodySize = Math.abs(open - close);
        const totalSize = parseFloat(candle[2]) - parseFloat(candle[3]); // high - low
        return close < open && bodySize > totalSize * 0.3; // Body should be at least 30% of total candle
    });

    // Analyze green candle tail
    const [, open, high, low, close] = greenCandle.map(parseFloat);
    const isGreenCandle = close > open;
    const bodySize = Math.abs(close - open);
    const totalSize = high - low;
    
    if (!hasRedCandles || !isGreenCandle) return { matches: false };

    const upperTail = high - Math.max(open, close);
    const lowerTail = Math.min(open, close) - low;
    
    // Check if tail is significant (at least 40% of total candle size)
    const tailLengthCondition = tailDirection === 'up' ? 
        (upperTail > totalSize * 0.4 && upperTail > bodySize) :
        (lowerTail > totalSize * 0.4 && lowerTail > bodySize);

    return {
        matches: tailLengthCondition,
        price: close,
        tailLength: tailDirection === 'up' ? upperTail : lowerTail,
        volume: parseFloat(greenCandle[5]),
        targets: calculateTargets(close, tailDirection === 'up'),
        stopLoss: calculateStopLoss(close, low, high, tailDirection === 'up'),
        expectedTime: calculateExpectedTime(greenCandle[0])
    };
}

// Calculate price targets
function calculateTargets(currentPrice, isUpward) {
    const multipliers = isUpward ? [1.02, 1.05, 1.10] : [0.98, 0.95, 0.90];
    return multipliers.map(m => currentPrice * m);
}

// Calculate stop loss level
function calculateStopLoss(close, low, high, isUpward) {
    if (isUpward) {
        return low - (high - low) * 0.1; // Add 10% buffer below the low
    } else {
        return high + (high - low) * 0.1; // Add 10% buffer above the high
    }
}

// Calculate expected time for the trade
function calculateExpectedTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
        timeZone: 'Africa/Algiers',
        hour12: false
    });
}

// Update results table
function updateResults(symbol, analysis) {
    const tbody = document.getElementById('resultsBody');
    const existingRow = Array.from(tbody.children).find(row => 
        row.children[0].textContent === symbol
    );
    
    if (existingRow) {
        tbody.removeChild(existingRow);
    }
    
    const row = document.createElement('tr');
    
    row.innerHTML = `
        <td>${symbol}</td>
        <td>${analysis.price.toFixed(8)}</td>
        <td>${analysis.tailLength.toFixed(8)}</td>
        <td>${analysis.volume.toFixed(2)}</td>
        <td>${analysis.targets.map(t => t.toFixed(8)).join('<br>')}</td>
        <td>${analysis.stopLoss.toFixed(8)}</td>
        <td>${analysis.expectedTime}</td>
        <td>
            <a href="https://www.binance.com/en/trade/${symbol}?type=spot" 
               target="_blank" rel="noopener noreferrer">
                ${analysis.price > analysis.stopLoss ? '📈' : '📉'}
            </a>
        </td>
        <td>${new Date().toLocaleString('en-US', { hour12: false })}</td>
    `;
    
    tbody.insertBefore(row, tbody.firstChild);
    
    // Limit table rows
    while (tbody.children.length > 100) {
        tbody.removeChild(tbody.lastChild);
    }
}

// Sort results table
function sortResults(criterion) {
    const tbody = document.getElementById('resultsBody');
    const rows = Array.from(tbody.children);
    
    rows.sort((a, b) => {
        const aValue = getCellValue(a, criterion);
        const bValue = getCellValue(b, criterion);
        return bValue - aValue;
    });
    
    rows.forEach(row => tbody.appendChild(row));
}

// Get cell value for sorting
function getCellValue(row, criterion) {
    const cell = row.querySelector(`td:nth-child(${getCellIndex(criterion)})`);
    return parseFloat(cell.textContent) || 0;
}

// Get cell index for sorting
function getCellIndex(criterion) {
    const indices = {
        price: 2,
        tailLength: 3,
        time: 9
    };
    return indices[criterion] || 1;
}

// Play notification sound
function playNotification() {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    gainNode.gain.value = volume / 100;
    oscillator.frequency.value = 440;
    
    oscillator.start();
    setTimeout(() => oscillator.stop(), 200);
}

// Toggle sound notifications
function toggleSound(event) {
    soundEnabled = event.target.checked;
}

// Update notification volume
function updateVolume(event) {
    volume = event.target.value;
}

// Disable/enable controls during analysis
function disableControls(disabled) {
    document.getElementById('timeframe').disabled = disabled;
    document.querySelectorAll('input[name="tailDirection"]').forEach(radio => {
        radio.disabled = disabled;
    });
    document.getElementById('refreshData').disabled = disabled;
    document.getElementById('resetSettings').disabled = disabled;
}

// Refresh data manually
async function refreshData() {
    if (!analysisRunning) {
        const tbody = document.getElementById('resultsBody');
        tbody.innerHTML = '';
        await startAnalysis();
    }
}

// Reset all settings to default
function resetSettings() {
    if (!analysisRunning) {
        document.getElementById('timeframe').value = '1m';
        document.getElementById('tailUp').checked = true;
        document.getElementById('soundToggle').checked = true;
        document.getElementById('volumeControl').value = 50;
        document.getElementById('resultsBody').innerHTML = '';
        volume = 50;
        soundEnabled = true;
    }
}