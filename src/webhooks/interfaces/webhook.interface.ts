/**
 * Webhook Response Interface
 *
 * Returned by the webhook controller to the payment provider
 */
export interface IWebhookResponse {
  status: number;
  message: string;
  webhookEventId?: string;
  paymentId?: string;
}

/**
 * Webhook Processing Result
 *
 * Internal result from webhook processing service
 */
export interface IWebhookProcessingResult {
  success: boolean;
  isDuplicate: boolean;
  paymentId?: string;
  subscriptionId?: string;
  error?: string;
}
