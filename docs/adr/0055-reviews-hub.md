# 0055 — A reviews page: deals waiting for a review, and reviews received and given

- Status: Accepted
- Date: 2026-10-10
- Builds on [ADR-0018](0018-reviews-and-trust.md) (reviews after a real deal).

## Context

Reviews could only be written from the conversation about a sold listing, and a user could see the
reviews about them only on their public profile. Nothing showed which deals were still waiting for
a review, how long was left, or the reviews a user had given. The owner asked for one reviews page in
the app, like the big classifieds apps have.

## Decision

- **Two read-only endpoints in trust**, both for the signed-in caller only:
  - `GET /api/v1/trust/me/pending-reviews`: finished deals the caller may still review, closest
    deadline first (at most 50). The query applies the same rules as `decideEligibility`: the listing
    is sold within `REVIEW_WINDOW_DAYS`, exactly one of the two owns it, both wrote to the other about
    it, and the caller has not reviewed that person for it (withdrawn and removed reviews count, as
    before). Each item has the listing, the other person (id, display name when trust knows it,
    role) and the deadline. An integration test compares it with eligibility on the same deals.
  - `GET /api/v1/trust/me/reviews?direction=received|given`: the caller's visible reviews, newest
    first, from their side of the deal (`other` is the person reviewed, or the reviewer).
- **No new data and no events.** Everything comes from trust's existing projections (listings,
  contacts, people) and reviews. Names still never travel in events; a name trust does not know is
  shown as "the buyer" / "the seller".
- **One page in both clients.** The app's _Reviews_ (Account) and the website's `/my/reviews` (the
  account menu) have tabs _Received_ and _Given_. Deals waiting for a review are cards on _Given_,
  which opens first while any wait. Each card says "How was it to buy from X?" (or to sell to), the
  days left, and opens the existing review form. Writing a review is unchanged: the same endpoint and
  the same eligibility check.

## Consequences

- A seller who talked with several people about a sold listing sees a card for each of them, as
  eligibility already allowed reviewing any of them once.
- The cards show the listing's photo when the listing can still be read; a deleted listing shows a
  placeholder.
