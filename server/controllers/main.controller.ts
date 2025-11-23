import type { Request, Response, NextFunction } from "express";
import {
  setupSSEHeaders,
  sendRecentSSEEvents,
  registerSSEClient,
  setupSSEKeepAlive,
  handleSSEDisconnect,
  validateSMSData,
  createIncomingMessage,
  handleTwilioCampaignOptIn,
  findOrCreateOrder,
  saveAndEmitIncomingMessage,
  sendAndSaveConfirmationMessage,
  sendAndSaveOptInReminder,
  processOrderDetectionAndAI,
} from "../services/main.service.js";

// Handles SSE connection setup and client registration
export async function handleSSEConnectionController(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req.user as any).id;

    // Set up SSE headers and send connection event
    setupSSEHeaders(res);

    // Send recent events from Redis (if in production)
    await sendRecentSSEEvents(userId, res);

    // Register this client connection
    registerSSEClient(userId, res);

    // Set up keep-alive to prevent connection timeout
    const keepAlive = setupSSEKeepAlive(res);

    // Handle client disconnection
    req.on("close", () => {
      handleSSEDisconnect(userId, res, keepAlive);
    });
  } catch (error) {
    next(error);
  }
}

// Handles incoming SMS webhook from Twilio
export async function handleSMSReplyController(req: Request, res: Response, next: NextFunction) {
  try {
    const { From, To, Body } = req.body || {};

    console.log('[SMS Reply] Incoming SMS', {
      from: From,
      to: To,
      body: Body,
    });

    // Validate and extract SMS data
    const smsData = validateSMSData(req.body);
    if (!smsData) {
      res.status(200).type('text/xml').send('<Response></Response>');
      return;
    }

    const { incomingNumber, messageText } = smsData;

    // Create message object
    const message = createIncomingMessage(messageText);

    // Handle Twilio Campaign opt-in flow
    const optInResult = await handleTwilioCampaignOptIn(incomingNumber, messageText);

    // If user has opted out, ignore the message completely
    if (optInResult.shouldIgnore) {
      res.status(200).type('text/xml').send('<Response></Response>');
      return;
    }

    // Find or create order (always needed for saving messages and emitting SSE)
    const { userId, orderId, isNewOrder } = await findOrCreateOrder(
      incomingNumber,
      messageText,
      optInResult.shouldProcessNormally
    );

    // Save message and emit SSE event immediately
    await saveAndEmitIncomingMessage(userId, orderId, message, incomingNumber, isNewOrder);

    // Send confirmation message if needed (for ORDER keyword) - async
    if (optInResult.confirmationMessage) {
      sendAndSaveConfirmationMessage(userId, orderId, incomingNumber, optInResult.confirmationMessage).catch(console.error);
    }

    // Send opt-in reminder if needed - async
    if (optInResult.shouldSendOptInReminder) {
      sendAndSaveOptInReminder(userId, orderId, incomingNumber).catch(console.error);
    }

    // Send response immediately to prevent webhook timeouts and retries
    res.status(200).type('text/xml').send('<Response></Response>');

    // Process order detection and AI suggestion asynchronously (only if processing normally)
    if (optInResult.shouldProcessNormally) {
      processOrderDetectionAndAI(userId, orderId, message, incomingNumber, isNewOrder).catch(console.error);
    }
  } catch (error) {
    console.error('[SMS Reply] Error handling incoming SMS:', error);
    res.status(500).type('text/xml').send('<Response></Response>');
  }
}

