import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EraPowerAutomationService } from './erapower-automation.service';

export interface DmsStockResult {
  inStock: boolean;
  stockQty: number;
  binLocation: string | null;
  listPriceCents: number | null;
  eta: string | null;
  probeSuccess: boolean;
  source: 'erapower_live' | 'unconfigured';
  error?: string;
}

export interface DmsOrderResponse {
  success: boolean;
  dmsOrderNumber: string;
  injectedAt: Date;
  requiresStaffEntry: boolean;
  reason: string;
}

@Injectable()
export class PentanaDmsService {
  private readonly logger = new Logger(PentanaDmsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly eraPowerService: EraPowerAutomationService,
  ) {}

  /**
   * Probes Pentana eraPower DMS for stock availability and bin location at a specific site.
   */
  async probeInventory(
    partNumber: string,
    siteCode: string,
    brandCode?: string,
  ): Promise<DmsStockResult> {
    try {
      const stock = this.eraPowerService.resolveEraPowerStock(partNumber, siteCode);
      return { ...stock, listPriceCents: null, probeSuccess: true, source: 'erapower_live' };
    } catch (error: any) {
      this.logger.warn(`Pentana read unavailable for ${partNumber} at ${siteCode}: ${error?.message}`);
      return {
        inStock: false,
        stockQty: 0,
        binLocation: null,
        listPriceCents: null,
        eta: null,
        probeSuccess: false,
        source: 'unconfigured',
        error: 'PENTANA_READ_SOURCE_NOT_CONFIGURED',
      };
    }
  }

  /**
   * Injects an accepted order into Pentana eraPower DMS Counter & Dispatch queue.
   */
  async submitOrderToDms(orderPayload: {
    orderNumber: string;
    tradeAccountId: string;
    rooftopId: string;
    totalCents: number;
    lines: Array<{ partNumber: string; quantity: number; unitPriceCents: number }>;
  }): Promise<DmsOrderResponse> {
    return {
      success: false,
      dmsOrderNumber: '',
      injectedAt: new Date(),
      requiresStaffEntry: true,
      reason: 'PENTANA_WRITEBACK_REQUIRES_SITE_CONFIRMATION',
    };
  }
}
