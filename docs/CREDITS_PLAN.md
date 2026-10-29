# TrustHub Connect: credits and payments (plan, not built)

Status: planned for after the Anthropic API key is in place. Nothing here is live.

## How credits work today
- New people get 10 welcome credits once.
- Each review, business added or listing earns 1 credit.
- Ask Wisdom deep questions cost 1 credit, charged only after an answer exists.
- Plain searches are always free.

## Proposed: top-up for when credits run out
- Price: 35 US cents buys 10 credits (the price set earlier by Benita).
- When someone has no credits, Ask Wisdom deep questions offer a top-up:
  "Buy 10 credits for 35 cents" as a button. Searches stay free.
- Every top-up is recorded in the credit ledger against a unique payment reference,
  so a repeated payment notice can never add credits twice.
- Credits are added only after the payment provider confirms the payment.

## Open decisions for tomorrow
1. Payment provider that accepts payments from people in Zimbabwe (mobile money
   or card). Needs checking before we commit to one.
2. Whether purchased credits expire, and whether free credits stay free.
3. Whether a top-up is offered in other places, such as after a scam check or a listing.
4. Admin reporting: top-ups per day and revenue, shown on the admin page.

## Technical outline
- New table or ledger reasons for purchases, keyed by provider payment reference.
- A webhook from the payment provider that confirms payment before crediting.
- Price and pack size stored in configuration, not hard-coded.
