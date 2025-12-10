import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
});

export async function POST(request: NextRequest) {
  try {
    const { walletAddress, couponCode } = await request.json();

    // Validate inputs
    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address required' },
        { status: 400 }
      );
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Validate Stripe configuration
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Stripe is not configured' },
        { status: 500 }
      );
    }

    if (!process.env.STRIPE_PRICE_ID) {
      return NextResponse.json(
        { error: 'Stripe price is not configured. Set STRIPE_PRICE_ID environment variable.' },
        { status: 500 }
      );
    }

    // Create or retrieve customer
    // Note: Stripe API doesn't support filtering customers by metadata in list()
    // We need to search by email or create a new customer each time
    // For this use case, we'll create a new customer per subscription
    const customer = await stripe.customers.create({
      metadata: {
        walletAddress: walletAddress.toLowerCase(),
      },
    });

    // Validate promotion code if provided
    let promotion_code_id = undefined;
    if (couponCode && couponCode.trim()) {
      try {
        console.log(`[Stripe] Validating promotion code: ${couponCode.trim()}`);
        // Search for the promotion code
        const promotionCodes = await stripe.promotionCodes.list({
          code: couponCode.trim(),
          limit: 1,
        });

        if (promotionCodes.data.length === 0) {
          console.log(`[Stripe] Promotion code not found`);
          return NextResponse.json(
            { error: 'Invalid promotion code' },
            { status: 400 }
          );
        }

        const promotionCode = promotionCodes.data[0];
        console.log(`[Stripe] Promotion code retrieved:`, promotionCode.id);

        if (!promotionCode.active) {
          console.log(`[Stripe] Promotion code is not active`);
          return NextResponse.json(
            { error: 'This promotion code is no longer active' },
            { status: 400 }
          );
        }

        // Apply the promotion code
        promotion_code_id = promotionCode.id;
        console.log(`[Stripe] Promotion code ${promotion_code_id} will be applied to subscription`);
      } catch (error: any) {
        // Promotion code lookup failed
        console.error(`[Stripe] Error validating promotion code:`, error.message);
        return NextResponse.json(
          { error: `Invalid promotion code: ${error.message || 'Not found'}` },
          { status: 400 }
        );
      }
    }

    // Create subscription
    const subscriptionParams: any = {
      customer: customer.id,
      items: [
        {
          price: process.env.STRIPE_PRICE_ID,
        },
      ],
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
        payment_method_types: ['card'],
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        walletAddress: walletAddress.toLowerCase(),
      },
      // Always require payment method collection, even if first invoice is $0
      // This ensures we can charge after promotional period ends
      collection_method: 'charge_automatically',
    };

    // Add promotion code if provided
    if (promotion_code_id) {
      // For subscriptions, use discounts array with promotion_code
      subscriptionParams.discounts = [{ promotion_code: promotion_code_id }];
      console.log(`[Stripe] Adding promotion code ${promotion_code_id} to subscription via discounts array`);
    }

    const subscription = await stripe.subscriptions.create(subscriptionParams);

    console.log(`[Stripe] Created subscription: ${subscription.id} for wallet ${walletAddress}`);

    const invoice = subscription.latest_invoice as Stripe.Invoice;

    if (!invoice) {
      console.error(`[Stripe] No invoice found for subscription ${subscription.id}`);
      return NextResponse.json(
        { error: 'Failed to create invoice' },
        { status: 500 }
      );
    }

    console.log(`[Stripe] Invoice ID: ${invoice.id}, Status: ${invoice.status}, Amount: ${invoice.amount_due}`);

    // Get discount information if available
    let discountInfo = null;
    if (invoice.discount || (invoice.total_discount_amounts && invoice.total_discount_amounts.length > 0)) {
      const discountAmount = invoice.total_discount_amounts?.[0]?.amount || 0;
      const originalAmount = invoice.subtotal || 0;
      const finalAmount = invoice.amount_due || 0;

      discountInfo = {
        originalAmount: (originalAmount / 100).toFixed(2), // Convert cents to dollars
        discountAmount: (discountAmount / 100).toFixed(2),
        finalAmount: (finalAmount / 100).toFixed(2),
        promotionCode: invoice.discount?.promotion_code || null,
      };

      console.log(`[Stripe] Discount applied:`, discountInfo);
    }

    const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent | null;

    // If there's no payment intent (e.g., $0 invoice due to 100% discount)
    // We need to create a SetupIntent to collect payment method for future charges
    if (!paymentIntent) {
      console.log(`[Stripe] No payment intent for $0 invoice - creating SetupIntent to collect payment method`);

      const setupIntent = await stripe.setupIntents.create({
        customer: customer.id,
        payment_method_types: ['card'],
        metadata: {
          subscription_id: subscription.id,
          wallet_address: walletAddress.toLowerCase(),
        },
      });

      console.log(`[Stripe] SetupIntent created: ${setupIntent.id}`);

      return NextResponse.json({
        success: true,
        subscriptionId: subscription.id,
        customerId: customer.id,
        clientSecret: setupIntent.client_secret,
        isSetupIntent: true, // Flag to indicate this is setup, not payment
        discount: discountInfo,
      });
    }

    if (!paymentIntent.client_secret) {
      console.error(`[Stripe] Payment intent exists but has no client_secret:`, paymentIntent.id);
      return NextResponse.json(
        { error: 'Failed to get payment client secret' },
        { status: 500 }
      );
    }

    console.log(`[Stripe] Payment intent: ${paymentIntent.id}, Status: ${paymentIntent.status}`);

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      clientSecret: paymentIntent.client_secret,
      isSetupIntent: false,
      discount: discountInfo,
    });
  } catch (error: any) {
    console.error('Stripe subscription creation error:', error);

    return NextResponse.json(
      {
        error: 'Failed to create subscription',
        details: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
