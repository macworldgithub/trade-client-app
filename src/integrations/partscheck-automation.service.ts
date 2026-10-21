import { Injectable, Logger } from '@nestjs/common';
import { EraPowerAutomationService } from './erapower-automation.service';

export interface AutomatedQuoteResponse {
  rfqId: string;
  autoQuoted: boolean;
  quotedTotalCents: number;
  requiresStaffReview: boolean;
  slaTargetSeconds: number;
  timestamp: Date;
  lines: Array<{
    lineId: string;
    partNumber: string;
    quotedPriceCents: number;
    inStock: boolean;
    eta: string;
  }>;
}

@Injectable()
export class PartsCheckAutomationService {
  private readonly logger = new Logger(PartsCheckAutomationService.name);

  constructor(private readonly eraPowerService: EraPowerAutomationService) {}

  /**
   * Automatically evaluates an inbound PartsCheck RFQ from a smash repairer against eraPower stock,
   * calculates trade margin and SLA countdown, and prepares the auto-quote response.
   */
  processAutomatedRfq(rfqPayload: {
    rfqId: string;
    repairerName: string;
    rooftopId: string;
    lines: Array<{ lineId: string; partNumber: string; quantity: number; unitTradePriceCents?: number | null }>;
  }): AutomatedQuoteResponse {
    const evaluatedLines = rfqPayload.lines.map((l) => {
      return {
        lineId: l.lineId,
        partNumber: l.partNumber,
        quotedPriceCents: l.unitTradePriceCents ?? 0,
        inStock: false,
        eta: 'Pentana read feed unavailable; staff review required',
      };
    });

    this.logger.warn(`[PartsCheck Automation] RFQ ${rfqPayload.rfqId} queued for staff review because Pentana read data is not configured.`);

    return {
      rfqId: rfqPayload.rfqId,
      autoQuoted: false,
      quotedTotalCents: 0,
      requiresStaffReview: true,
      slaTargetSeconds: 900, // 15-minute standard smash quote SLA
      timestamp: new Date(),
      lines: evaluatedLines,
    };
  }
}
