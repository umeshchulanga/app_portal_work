// Existing report keys and fee rules are intentionally preserved.
const VEHICLE_CATEGORIES = {
    "car": [
        "මෝටර් කාර්"
    ],
    "dual": [
        "ද්විත්ව කාර්ය වාහන"
    ],
    "tractor": [
        "අත් ට්‍රැක්ටර්",
        "සැහැල්ලු ට්‍රේලර්",
        "ට්‍රැක්ටර් ට්‍රේලර්"
    ],
    "bike": [
        "සැහැල්ලු මෝටර් සයිකල්",
        "මෝටර් සයිකල්"
    ],
    "tri": [
        "මෝටර් ට්‍රයිසිකල් වෑන්"
    ],
    "lorry": [
        "සැහැල්ලු මෝටර් ලොරි",
        "මෝටර් ලොරි",
        "ප්‍රයිවට් මෝටර් ලොරි",
        "මෝටර් ගිලන් රථ",
        "මෝටර් අවමංගල රථ"
    ],
    "trailer": [
        "බර ට්‍රේලර්",
        "ලොරි ට්‍රේලර්"
    ],
    "bus": [
        "බස් රථ",
        "පෞද්ගලික කෝච්"
    ],
    "licence": [
        "නොබැඳි පත් නිකුත් කිරීම"
    ],
    "other": [
        "වෙනත්"
    ]
};

function buildReportData(activeFilteredQueue, rightNow = new Date()) {
    const summary = Object.fromEntries(Object.entries(VEHICLE_CATEGORIES).map(([key, types]) => [key, { count: 0, total: 0, unitPrices: [], types }]));

    let grandCount = 0;
    let grandTotal = 0;

    const rolesPayload = activeFilteredQueue.map((item, index) => {
        // FIX: Amount 1 නොසලකා හැර, Amount 2 පමණක් එක් එක් වාහනය සඳහා ගාස්තුව ලෙස සලකයි
        const unitPriceFee = parseFloat(item.amt2) || 0;

        for (const key in summary) {
            if (summary[key].types.includes(item.vehType)) {
                summary[key].count += 1;
                summary[key].total += unitPriceFee; // මුළු එකතුවට එකතු කරන්නේ amt2 පමණි
                
                if (unitPriceFee > 0) {
                    summary[key].unitPrices.push(unitPriceFee);
                }
                grandCount += 1;
                grandTotal += unitPriceFee;
                break;
            }
        }

        return {
            idx: String(index + 1).padStart(2, '0'),
            vehicle_number: item.vehNo,
            vehicle_type: item.vehType,
            ownr_name_address: item.ownerDetails,
            receipt_01: item.rec1,
            receipt_02: item.rec2 || "",
            receipt_01_fee: item.amt1,
            receipt_02_fee: item.amt2 || ""
        };
    });

    const getUnitPrice = (cat) => {
        if (cat.unitPrices.length === 0) return "-";
        const average = cat.unitPrices.reduce((a, b) => a + b, 0) / cat.unitPrices.length;
        return average.toFixed(2);
    };

    
    const localYear = String(rightNow.getFullYear());
    const localMonth = String(rightNow.getMonth() + 1).padStart(2, '0');

    const templateData = {
        year: localYear,
        month: localMonth,
        roles: rolesPayload,

        // Unit Prices placeholders
        motor_car_unit_price:       getUnitPrice(summary.car),
        dual_purpose_unit_price:    getUnitPrice(summary.dual),
        hand_tractor:               getUnitPrice(summary.tractor), 
        light_weigh_talor:          getUnitPrice(summary.tractor),
        tractor_talor:              getUnitPrice(summary.tractor),
        light_motor_cycle:          getUnitPrice(summary.bike),
        motor_cycle:                getUnitPrice(summary.bike),
        motor_tricycle:             getUnitPrice(summary.tri),
        motor_tricycle_van:         getUnitPrice(summary.tri),
        light_motor_lorry:          getUnitPrice(summary.lorry),
        motor_lorry:                getUnitPrice(summary.lorry),
        prime_mover:                getUnitPrice(summary.lorry),
        ambulance:                  getUnitPrice(summary.lorry),
        hearse:                     getUnitPrice(summary.lorry),
        heavy_talor:                getUnitPrice(summary.trailer),
        lorry_talor:                getUnitPrice(summary.trailer),
        omni_bus:                   getUnitPrice(summary.bus),
        private_coach:              getUnitPrice(summary.bus),
        licence_history_report:     getUnitPrice(summary.licence), 
        other:                      getUnitPrice(summary.other),   

        // Counts placeholders
        car_count:     summary.car.count || "-",
        dual_count:    summary.dual.count || "-",
        tractor_count: summary.tractor.count || "-",
        bike_count:    summary.bike.count || "-",
        tri_count:     summary.tri.count || "-",
        lorry_count:   summary.lorry.count || "-",
        trailer_count: summary.trailer.count || "-",
        bus_count:     summary.bus.count || "-",
        licence_count: summary.licence.count || "-",
        other_count:   summary.other.count || "-",

        // Totals placeholders (කාණ්ඩයේ මුළු එකතුව = වාහන ගණන x Amount 2)
        car_total:     summary.car.total ? summary.car.total.toFixed(2) : "-",
        dual_total:    summary.dual.total ? summary.dual.total.toFixed(2) : "-",
        tractor_total: summary.tractor.total ? summary.tractor.total.toFixed(2) : "-",
        bike_total:    summary.bike.total ? summary.bike.total.toFixed(2) : "-",
        tri_total:     summary.tri.total ? summary.tri.total.toFixed(2) : "-",
        lorry_total:   summary.lorry.total ? summary.lorry.total.toFixed(2) : "-",
        trailer_total: summary.trailer.total ? summary.trailer.total.toFixed(2) : "-",
        bus_total:     summary.bus.total ? summary.bus.total.toFixed(2) : "-",
        licence_total: summary.licence.total ? summary.licence.total.toFixed(2) : "-",
        other_total:   summary.other.total ? summary.other.total.toFixed(2) : "-",

        grand_count:   grandCount,
        grand_total:   grandTotal.toFixed(2)
    };


    return templateData;
}
