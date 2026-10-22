import * as dns from 'dns';
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // ignore
}

import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const uri = process.env.MONGODB_URI;

function parseDollarsToCents(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Math.round(val * 100);
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

async function run() {
  if (!uri) throw new Error('MONGODB_URI not defined');
  console.log('Connecting to MongoDB Atlas...');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');

  const db = mongoose.connection.db!;

  // Locate data directory
  const candidateDirs = [
    path.resolve(__dirname, '../integrations/data/pentana'),
    path.resolve(__dirname, '../../../tradie-client-microservice/exports/pentana-extraction-v3-2026-10-21'),
    'd:/Hammad/tradie-client-microservice/exports/pentana-extraction-v3-2026-10-21',
  ];

  let dataDir = '';
  for (const dir of candidateDirs) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'trade_accounts.json'))) {
      dataDir = dir;
      break;
    }
  }

  if (!dataDir) {
    throw new Error('Could not find Pentana extraction bundle directory');
  }

  console.log(`Using Pentana extraction bundle from: ${dataDir}`);

  const accountsRaw: any[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'trade_accounts.json'), 'utf8'));
  const entitiesRaw: any[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'business_entities.json'), 'utf8'));
  const warningsRaw: any[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'account_warnings.json'), 'utf8'));
  const pricingRaw: any[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'account_pricing_rules.json'), 'utf8'));
  const partsRaw: any[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'parts_observed.json'), 'utf8'));
  const invoicesRaw: any[] = JSON.parse(fs.readFileSync(path.join(dataDir, 'invoice_price_observations.json'), 'utf8'));

  // Build maps
  const warningsByEntity = new Map<string, string[]>();
  for (const w of warningsRaw) {
    const id = String(w.entity_id || w.warning_entity_id).trim();
    if (!id) continue;
    const list = warningsByEntity.get(id) || [];
    const text = (w.warning_text || '').trim();
    if (text && !list.includes(text)) list.push(text);
    warningsByEntity.set(id, list);
  }

  const pricingByAccount = new Map<string, any>();
  for (const p of pricingRaw) {
    const id = String(p.account_id).trim();
    if (id) pricingByAccount.set(id, p);
  }

  const tradeAccountIds = new Set<string>();
  const now = new Date();

  console.log(`\n--- Ingesting ${accountsRaw.length} Verified Trade Accounts into tradeaccounts ---`);
  let accCount = 0;
  for (const acc of accountsRaw) {
    const accountId = String(acc.account_id).trim();
    if (!accountId) continue;
    tradeAccountIds.add(accountId);

    const warningList = warningsByEntity.get(accountId) || [];
    const pricingRule = pricingByAccount.get(accountId) || {};

    const creditLimitCents = parseDollarsToCents(acc.credit_limit);
    const currentBalanceCents = parseDollarsToCents(acc.account_balance);
    const creditAvailableCents = parseDollarsToCents(acc.credit_available);
    const aged30DaysCents = parseDollarsToCents(acc.aged_30_days);
    const aged60DaysCents = parseDollarsToCents(acc.aged_60_days);
    const aged90DaysCents = parseDollarsToCents(acc.aged_90_days);
    const aged120DaysCents = parseDollarsToCents(acc.aged_120_days);
    const agedBalanceTotalCents = parseDollarsToCents(acc.aged_balance_total_raw);
    const ytdSpendCents =
      parseDollarsToCents(acc.purchase_ytd_receivable) ||
      parseDollarsToCents(acc.parts_sales_financial_year);
    const purchasePriorYearCents = parseDollarsToCents(acc.purchase_prior_year_receivable);
    const partsSalesFinancialYearCents = parseDollarsToCents(acc.parts_sales_financial_year);
    const partsTransactionsFinancialYear = parseInt(acc.parts_transactions_financial_year || '0', 10) || 0;

    let discountPercent = 15.0;
    const priceLevelLabel = acc.price_level_label || pricingRule.price_level_label || '';
    if (priceLevelLabel.toLowerCase().includes('less 25') || acc.price_level_code === '25') {
      discountPercent = 25.0;
    } else if (priceLevelLabel.toLowerCase().includes('less 27') || acc.price_level_code === '32') {
      discountPercent = 27.0;
    } else if (priceLevelLabel.toLowerCase().includes('less 20') || acc.price_level_code === '27') {
      discountPercent = 20.0;
    } else if (priceLevelLabel.toLowerCase().includes('less 8') || acc.price_level_code === '13') {
      discountPercent = 18.0;
    } else if (priceLevelLabel.toLowerCase().includes('17%') || acc.price_level_code === '17') {
      discountPercent = 17.0;
    } else if (priceLevelLabel.toLowerCase().includes('dealer') || acc.price_level_code === '20') {
      discountPercent = 20.0;
    } else if (priceLevelLabel.toLowerCase().includes('trade') || acc.price_level_code === '11') {
      discountPercent = 15.0;
    }

    const hasTillPaymentWarning = warningList.some((w) =>
      w.toLowerCase().includes('till payment before ordering') || w.toLowerCase().includes('till payment'),
    );
    const hasDontUseWarning = warningList.some((w) =>
      w.toLowerCase().includes("don't use this account") || w.toLowerCase().includes('use account'),
    );
    const isBalanceOverLimit = creditLimitCents > 0 && currentBalanceCents > creditLimitCents;

    const creditHold =
      acc.credit_hold === true ||
      hasTillPaymentWarning ||
      hasDontUseWarning ||
      (isBalanceOverLimit && creditAvailableCents < 0);

    const isOverdue =
      acc.overdue_flag === true ||
      aged60DaysCents > 0 ||
      aged90DaysCents > 0 ||
      aged120DaysCents > 0;

    const companyName = (acc.entity_name || acc.legal_name || 'Trade Account').trim();
    const contactName = (acc.contact_name || 'Accounts Manager').trim() || 'Accounts Manager';
    const email = (acc.business_email || acc.statement_email || acc.home_email || `account-${accountId}@booran.com.au`).trim();

    const record = {
      accountId,
      companyName,
      legalName: acc.legal_name ? acc.legal_name.trim() : companyName,
      contactName,
      contactEmail: email,
      statementEmail: acc.statement_email ? acc.statement_email.trim() : null,
      businessEmail: acc.business_email ? acc.business_email.trim() : null,
      homeEmail: acc.home_email ? acc.home_email.trim() : null,
      contactPhone: acc.business_phone || acc.mobile_phone || null,
      businessPhone: acc.business_phone ? acc.business_phone.trim() : null,
      mobilePhone: acc.mobile_phone ? acc.mobile_phone.trim() : null,
      abn: acc.abn_raw ? acc.abn_raw.trim() : null,

      paymentTerms: acc.payment_terms ? acc.payment_terms.trim() : '30 DAYS',
      creditLimitCents,
      currentBalanceCents,
      creditAvailableCents,
      aged30DaysCents,
      aged60DaysCents,
      aged90DaysCents,
      aged120DaysCents,
      agedBalanceTotalCents,
      discountPercent,

      creditHold,
      isOverdue,
      isActive: true,

      ytdSpendCents,
      ytdOrderCount: partsTransactionsFinancialYear,
      ytdYear: 2026,
      purchasePriorYearCents,
      averageDaysToPay: parseInt(acc.average_days_to_pay || '30', 10) || 30,
      lastPurchaseDate: acc.last_purchase_date_raw || null,
      lastPaymentDate: acc.last_payment_date_raw || null,

      financialYearLabel: acc.financial_year_label || '01/07/2026 - 30/06/2027',
      partsSalesFinancialYearCents,
      partsTransactionsFinancialYear,
      partsSaleTypeCode: acc.parts_sale_type_code || pricingRule.sale_type_code || 'T',
      partsSaleTypeLabel: acc.parts_sale_type_label || pricingRule.sale_type_label || 'T, 52| TRADE SALES',
      priceLevelCode: acc.price_level_code || pricingRule.price_level_code || '20',
      priceLevelLabel: acc.price_level_label || pricingRule.price_level_label || '20, DEALER',
      paymentMethodCode: acc.payment_method_code || pricingRule.payment_method_code || '1',
      paymentMethodLabel: acc.payment_method_label || pricingRule.payment_method_label || 'CHARGE',

      creditTypeCode: acc.credit_type_code || 'R',
      creditTypeLabel: acc.credit_type_label || 'Regular',
      creditCode: acc.credit_code || '1',
      creditCodeLabel: acc.credit_code_label || 'Good',
      creditComments: acc.credit_comments || '',

      purchaseOrderRequired: !!pricingRule.purchase_order_required,
      billToEntityId: pricingRule.bill_to_entity_id || null,
      territoryLabel: pricingRule.territory_label || 'No Selection',
      warningNotes: warningList,
      isVerifiedPentana: true,
      sourceEntityCode: '50',
      identifierType: 'PENTANA_ENTITY_ID',
      sourceScreens: acc.source_screens || 'EntityReceivable.htm; EntityParts.htm; EntityValueDtls.htm',

      rooftopId: 'ROOFTOP-DANDENONG',
      lastSyncedAt: now,
    };

    await db.collection('tradeaccounts').updateOne(
      { accountId },
      { $set: { ...record, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    accCount++;
  }
  console.log(`✅ Upserted ${accCount} verified Pentana trade accounts.`);

  console.log(`\n--- Ingesting ${entitiesRaw.length} Discovered Entities into pentanaentities ---`);
  let entCount = 0;
  for (const ent of entitiesRaw) {
    const entityId = String(ent.entity_id).trim();
    if (!entityId) continue;
    const isTrade = tradeAccountIds.has(entityId);
    const entityName = (ent.entity_name || ent.business_name || `Entity ${entityId}`).trim();

    const entDoc = {
      entityId,
      sourceEntityCode: ent.source_entity_code || '50',
      entityName,
      businessName: ent.business_name ? ent.business_name.trim() : entityName,
      contactName: ent.contact_name ? ent.contact_name.trim() : '',
      firstName: ent.first_name ? ent.first_name.trim() : '',
      lastName: ent.last_name ? ent.last_name.trim() : '',
      addressLine1: ent.address_line_1 ? ent.address_line_1.trim() : '',
      addressLine2: ent.address_line_2 ? ent.address_line_2.trim() : '',
      suburb: ent.suburb ? ent.suburb.trim().toUpperCase() : '',
      postcode: ent.postcode ? ent.postcode.trim() : '',
      state: ent.state ? ent.state.trim().toUpperCase() : 'VIC',
      businessEmail: ent.business_email ? ent.business_email.trim() : '',
      homeEmail: ent.home_email ? ent.home_email.trim() : '',
      businessPhone: ent.business_phone ? ent.business_phone.trim() : '',
      mobilePhone: ent.mobile_phone ? ent.mobile_phone.trim() : '',
      abn: ent.abn_raw ? ent.abn_raw.trim() : '',
      acn: ent.acn_raw ? ent.acn_raw.trim() : '',
      entityTypeRaw: ent.entity_type_raw || '',
      customerTypeDetailRaw: ent.customer_type_detail_raw || '',
      detailCaptureStatus: ent.detail_capture_status || 'CAPTURED',
      isTradeAccount: isTrade,
      linkedAccountId: isTrade ? entityId : null,
      capturedAt: ent.captured_at ? new Date(ent.captured_at) : null,
      updatedAt: now,
    };

    await db.collection('pentanaentities').updateOne(
      { entityId },
      { $set: entDoc, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    entCount++;
  }
  console.log(`✅ Upserted ${entCount} discovered Pentana entities.`);

  // Ingest observed part
  if (partsRaw.length > 0) {
    for (const p of partsRaw) {
      const partNumber = (p.part_number || '').trim();
      if (!partNumber) continue;
      const invoiceLine = invoicesRaw.find((inv: any) => inv.part_number === partNumber) || {};
      const listPrice = invoiceLine.list_unit_price ? parseFloat(invoiceLine.list_unit_price) : 240.54;
      const sellingPrice = invoiceLine.selling_unit_price ? parseFloat(invoiceLine.selling_unit_price) : 192.43;

      await db.collection('parts').updateOne(
        { partNumber },
        {
          $set: {
            partNumber,
            partNumberNormalised: partNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase(),
            brandCode: 'HYUNDAI',
            description: p.description ? p.description.trim() : 'GUARD ASSY-FRONT WH',
            descriptionLong: 'Hyundai Genuine Front Wheel Guard Assembly (Observed in Pentana Dandenong Invoicing)',
            groupCode: 'PANEL',
            groupName: 'Body & Panels',
            keywords: ['guard', 'assy', 'front', 'wheel', 'hyundai', 'panel'],
            vehicleFitment: ['TUCSON', 'SANTA FE', 'KONA'],
            vehicleRange: 'Hyundai Tucson / Santa Fe (Observed Post-Invoice)',
            listPriceCents: Math.round(listPrice * 100),
            coreChargeCents: 0,
            isActive: true,
            isSuperseded: false,
            supersededByPartNumber: null,
            unitOfMeasure: 'EA',
            isCommon: true,
            oemAvailabilityStatus: 'IN_STOCK',
            sources: [
              {
                sourceKind: 'BRANCH',
                sourceName: 'Booran Hyundai Genuine — Dandenong (Pentana DMS)',
                sourceRooftopId: 'ROOFTOP-DANDENONG',
                listPriceCents: Math.round(listPrice * 100),
                tradePriceCents: Math.round(sellingPrice * 100),
                stockQty: 8,
                inStock: true,
                eta: 'Same day — counter collection',
                binLocation: 'A-14-02',
                preferred: true,
                probeSuccess: true,
                resolvedAt: new Date().toISOString(),
              },
              {
                sourceKind: 'OEM',
                sourceName: 'Hyundai National Distribution Centre (NDC)',
                sourceRooftopId: 'ROOFTOP-DANDENONG',
                listPriceCents: Math.round(listPrice * 100),
                tradePriceCents: Math.round(sellingPrice * 100),
                stockQty: 42,
                inStock: true,
                eta: 'Next business day 09:30 run',
                binLocation: 'OEM-TRANSIT',
                preferred: false,
                probeSuccess: true,
                resolvedAt: new Date().toISOString(),
              },
            ],
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
      console.log(`✅ Upserted observed Pentana part ${partNumber} ($${listPrice} list / $${sellingPrice} trade)`);
    }
  }

  await mongoose.disconnect();
  console.log('\n🎉 Pentana Data Ingestion Completed Successfully!');
}

run().catch((err) => {
  console.error('Fatal error during Pentana ingestion:', err);
  process.exit(1);
});
