import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-02-24.acacia',
});

export async function POST(request: NextRequest) {
  try {
    const { subscriptionId, customerId, paymentMethodId } = await request.json();

    // Validate inputs
    if (!subscriptionId || !customerId || !paymentMethodId) {
      return NextResponse.json(
        { error: 'Subscription ID, customer ID, and payment method ID required' },
        { status: 400 }
      );
    }

    console.log(`[Stripe] Attaching payment method ${paymentMethodId} to customer ${customerId} and subscription ${subscriptionId}`);

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    console.log(`[Stripe] Payment method attached to customer`);

    // Set as default payment method for the customer
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    console.log(`[Stripe] Set as default payment method for customer`);

    // Retrieve the subscription to check for existing discounts
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    console.log(`[Stripe] Retrieved subscription, has ${subscription.discounts?.length || 0} discounts`);

    // Update the subscription to use this payment method while preserving discounts
    const updateParams: any = {
      default_payment_method: paymentMethodId,
    };

    // Preserve existing discounts if any
    if (subscription.discounts && subscription.discounts.length > 0) {
      updateParams.discounts = subscription.discounts.map((d: any) => ({
        coupon: d.coupon?.id,
        promotion_code: d.promotion_code,
      })).filter((d: any) => d.coupon || d.promotion_code);
      console.log(`[Stripe] Preserving ${updateParams.discounts.length} discounts during update`);
    }

    await stripe.subscriptions.update(subscriptionId, updateParams);

    console.log(`[Stripe] Updated subscription ${subscriptionId} with payment method`);

    return NextResponse.json({
      success: true,
      message: 'Payment method attached successfully',
    });
  } catch (error: any) {
    console.error('Stripe attach payment method error:', error);

    return NextResponse.json(
      {
        error: 'Failed to attach payment method',
        details: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
