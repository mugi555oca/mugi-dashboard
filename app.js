// Global Chart instances
let chartPriceNav, chartSpread, chartSupply;

// Colors matching PDF presentation
const colors = {
    primary: '#203A61',
    copper1: '#C58C6D',
    copper2: '#E6B89C',
    blue: '#3B74B8',
    taupe: '#B5A8A0'
};

document.addEventListener('DOMContentLoaded', () => {
    // Attach event listeners to sliders
    const ids = ['days', 'vol', 'drift', 'eps'];
    ids.forEach(id => {
        document.getElementById(`input-${id}`).addEventListener('input', (e) => {
            document.getElementById(`val-${id}`).innerText = e.target.value;
        });
    });

    document.getElementById('btn-run').addEventListener('click', runSim);
});

function formatNumber(num) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
}

function formatCurrency(num) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

function runSim() {
    // Read parameters
    const days = parseInt(document.getElementById('input-days').value);
    const initialCMET = parseFloat(document.getElementById('input-cmet').value);
    const initialPrice = parseFloat(document.getElementById('input-price').value);
    const vol = parseFloat(document.getElementById('input-vol').value) / 100;
    const drift = parseFloat(document.getElementById('input-drift').value) / 100;
    const eps = parseFloat(document.getElementById('input-eps').value) / 100;
    const dailyVolUSD = parseFloat(document.getElementById('input-vol-usd').value);

    // Initialization
    let price = initialPrice;
    let poolCMET = initialCMET;
    let poolUSDT = initialCMET * initialPrice;
    let totalCMET = initialCMET;
    let reservePhysical = initialCMET; // Start 100% backed in physical material (1 CMET = 1 unit)
    let reserveUSD = reservePhysical * initialPrice;
    let capturedValue = 0;
    let capturedPremium = 0;
    let capturedDiscount = 0;

    const data = {
        labels: [],
        spotPrice: [],
        nav: [],
        poolPrice: [],
        spread: [],
        supply: []
    };

    for (let t = 0; t <= days; t++) {
        // 1. Geometric Brownian Motion for Spot Price (starting Day 1)
        if (t > 0) {
            // Approx normal distribution
            let z = (Math.random() + Math.random() + Math.random() + Math.random() + Math.random() + Math.random() - 3) / 1.5;
            price = price * (1 + drift + vol * z);
        }

        // 2. Market Trading (Noise)
        // Add random external volume pushing the pool
        let tradeDir = (Math.random() - 0.5) * 2; // -1 to 1
        let tradeUSD = tradeDir * dailyVolUSD;
        let k = poolCMET * poolUSDT;

        if (tradeUSD > 0) { // Buy CMET (add USDT to pool)
            let newUSDT = poolUSDT + tradeUSD;
            poolCMET = k / newUSDT;
            poolUSDT = newUSDT;
        } else if (tradeUSD < 0) { // Sell CMET (remove USDT from pool)
            let newUSDT = poolUSDT + tradeUSD;
            if (newUSDT > 0) {
                poolCMET = k / newUSDT;
                poolUSDT = newUSDT;
            }
        }

        let poolPrice = poolUSDT / poolCMET;

        // 3. Treasury Intervention (StockUp & Redeem)
        if (poolPrice > price * (1 + eps)) {
            // Premium: Mint CMET, sell into pool to drive price down
            let targetPrice = price * (1 + eps / 2);
            let targetCMET = Math.sqrt(k / targetPrice);
            let dCMET = targetCMET - poolCMET; // CMET to mint
            if (dCMET > 0) {
                let dUSDT = poolUSDT - (k / targetCMET); // USDT received
                poolCMET += dCMET;
                poolUSDT -= dUSDT;
                totalCMET += dCMET;
                let boughtPhysical = dUSDT / price; // Buy physical material at spot price
                reservePhysical += boughtPhysical; 
                let profit = dUSDT - (dCMET * price);
                capturedValue += profit; // True arbitrage profit
                capturedPremium += profit;
            }
        } else if (poolPrice < price * (1 - eps)) {
            // Discount: Buy CMET from pool, burn it
            let targetPrice = price * (1 - eps / 2);
            let targetCMET = Math.sqrt(k / targetPrice);
            let dCMET = poolCMET - targetCMET; // CMET to buy from pool
            if (dCMET > 0) {
                let dUSDT = (k / targetCMET) - poolUSDT; // USDT needed
                if (reserveUSD >= dUSDT) {
                    poolCMET -= dCMET;
                    poolUSDT += dUSDT;
                    totalCMET -= dCMET;
                    let soldPhysical = dUSDT / price; // Sell physical material at spot price to get USDT
                    reservePhysical -= soldPhysical;
                    let profit = (dCMET * price) - dUSDT;
                    capturedValue += profit;
                    capturedDiscount += profit;
                }
            }
        }

        // 4. Update state variables
        poolPrice = poolUSDT / poolCMET;
        reserveUSD = reservePhysical * price; // Update reserve USD value based on current spot price
        let nav = reserveUSD / totalCMET;

        // 5. Store daily data
        data.labels.push(t);
        data.spotPrice.push(price);
        data.nav.push(nav);
        data.poolPrice.push(poolPrice);
        data.spread.push(((poolPrice / nav) - 1) * 100);
        data.supply.push(totalCMET);
    }

    updateDashboard(data, initialPrice, capturedValue, reserveUSD, initialCMET, capturedPremium, capturedDiscount);
    drawCharts(data);
}

function updateDashboard(data, initialPrice, capturedValue, reserveUSD, initialCMET, capturedPremium, capturedDiscount) {
    const finalNav = data.nav[data.nav.length - 1];
    const finalSupply = data.supply[data.supply.length - 1];

    document.getElementById('kpi-nav').innerText = formatCurrency(finalNav);
    document.getElementById('kpi-nav-sub').innerText = `Start: ${formatCurrency(initialPrice)}`;
    
    document.getElementById('kpi-res').innerText = `$${formatNumber(reserveUSD / 1000000)}M`;
    document.getElementById('kpi-res-sub').innerText = `Start: $${formatNumber((initialCMET * initialPrice) / 1000000)}M`;
    
    document.getElementById('kpi-supply').innerText = formatNumber(finalSupply);
    document.getElementById('kpi-supply-sub').innerText = `Start: ${formatNumber(initialCMET)}`;
    
    document.getElementById('kpi-captured').innerText = formatCurrency(capturedValue);
    document.getElementById('kpi-captured-sub').innerText = `Prem: ${formatCurrency(capturedPremium)} | Disc: ${formatCurrency(capturedDiscount)}`;
}

function drawCharts(data) {
    // Destroy existing charts to prevent overlap
    if (chartPriceNav) chartPriceNav.destroy();
    if (chartSpread) chartSpread.destroy();
    if (chartSupply) chartSupply.destroy();

    // Common Chart.js options for styling
    Chart.defaults.font.family = "'Montserrat', sans-serif";
    Chart.defaults.color = colors.taupe;

    // 1. Price vs NAV Chart
    const ctx1 = document.getElementById('chartPriceNav').getContext('2d');
    chartPriceNav = new Chart(ctx1, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: [
                {
                    label: 'Valyrium Spot Price',
                    data: data.spotPrice,
                    borderColor: colors.taupe,
                    borderDash: [5, 5],
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.1
                },
                {
                    label: 'Net Asset Value (NAV)',
                    data: data.nav,
                    borderColor: colors.copper1,
                    backgroundColor: 'rgba(197, 140, 109, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    pointRadius: 0,
                    tension: 0.1
                },
                {
                    label: 'CMET Pool Price',
                    data: data.poolPrice,
                    borderColor: colors.primary,
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top' } },
            scales: {
                y: { grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });

    // 2. Spread (Premium/Discount) Chart
    const ctx2 = document.getElementById('chartSpread').getContext('2d');
    chartSpread = new Chart(ctx2, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [{
                label: 'Premium / Discount (%)',
                data: data.spread,
                backgroundColor: data.spread.map(v => v > 0 ? colors.copper2 : colors.blue),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });

    // 3. CMET Supply Dynamics
    const ctx3 = document.getElementById('chartSupply').getContext('2d');
    chartSupply = new Chart(ctx3, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: [{
                label: 'Total CMET Supply',
                data: data.supply,
                borderColor: colors.primary,
                backgroundColor: 'rgba(32, 58, 97, 0.1)',
                borderWidth: 2,
                fill: true,
                pointRadius: 0,
                stepped: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}