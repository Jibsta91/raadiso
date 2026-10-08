# Marketplace rules for publishing a listing (ADR-0013). Evaluated by the
# listings service on create and update:
#   POST /v1/data/raadi/listings/decision
# Input:
#   action:    "create" | "update"
#   principal: {sub, roles}
#   listing:   {category, subcategory, title, description, country, price, imageCount}
#              price: {amountMinor, currency} or null (ADR-0040)
#   context:   {activeListings}
package raadi.listings

import rego.v1

max_active_listings := 50

max_images := 10

# Upper bounds that catch typos (an extra zero) and obvious scams, in minor units of the category's
# currency (øre for Norway, US cents for Somaliland). Categories without one have no ceiling.
price_ceiling := {
	# Norway (NOK)
	"torget": 100000000,
	"bil": 2000000000,
	"eiendom": 20000000000,
	"reise": 25000000,
	# Somaliland (USD)
	"vehicles": 50000000,
	"property": 300000000,
	"phones": 500000,
	"electronics": 2000000,
	"home": 1000000,
	"fashion": 1000000,
	"livestock": 10000000,
	"agriculture": 5000000,
	"services": 2000000,
	"business": 20000000,
	"kids": 200000,
	"sports-hobbies": 1000000,
}

decision := {"allow": count(deny) == 0, "reasons": sort([r | some r in deny])}

privileged if "platform-admin" in input.principal.roles

deny contains "quota_exceeded" if {
	input.action == "create"
	not privileged
	input.context.activeListings >= max_active_listings
}

deny contains "price_above_ceiling" if {
	ceiling := price_ceiling[input.listing.category]
	input.listing.price.amountMinor > ceiling
}

deny contains "too_many_images" if input.listing.imageCount > max_images

deny contains "prohibited_item" if {
	text := lower(concat(" ", [input.listing.title, input.listing.description]))
	words := {w | some w in regex.split(`[^\p{L}\p{N}]+`, text)}
	some term in data.raadi.prohibited_terms
	term in words
}
