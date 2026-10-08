package raadi.listings_test

import rego.v1

import data.raadi.listings

base := {
	"action": "create",
	"principal": {"sub": "u1", "roles": ["user"]},
	"listing": {
		"category": "torget",
		"subcategory": "sport",
		"title": "Langrennsski",
		"description": "Lite brukt",
		"country": "NO",
		"price": {"amountMinor": 150000, "currency": "NOK"},
		"imageCount": 2,
	},
	"context": {"activeListings": 3},
}

test_ordinary_listing_is_allowed if {
	listings.decision == {"allow": true, "reasons": []} with input as base
}

test_quota_applies_to_create_only if {
	full := object.union(base, {"context": {"activeListings": 50}})
	listings.decision.reasons == ["quota_exceeded"] with input as full
	listings.decision.allow with input as object.union(full, {"action": "update"})
}

test_platform_admin_is_exempt_from_quota if {
	admin := object.union(base, {"principal": {"sub": "a", "roles": ["user", "platform-admin"]}, "context": {"activeListings": 500}})
	listings.decision.allow with input as admin
}

test_price_ceiling_per_category if {
	pricey := object.union(base, {"listing": object.union(base.listing, {"price": {"amountMinor": 200000000, "currency": "NOK"}})})
	listings.decision.reasons == ["price_above_ceiling"] with input as pricey
	car := object.union(pricey, {"listing": object.union(pricey.listing, {"category": "bil"})})
	listings.decision.allow with input as car
}

test_price_ceiling_in_somaliland_dollars if {
	phone := object.union(base, {"listing": object.union(base.listing, {"category": "phones", "subcategory": "mobile-phones", "country": "XS", "price": {"amountMinor": 120000, "currency": "USD"}})})
	listings.decision.allow with input as phone
	typo := object.union(phone, {"listing": object.union(phone.listing, {"price": {"amountMinor": 12000000, "currency": "USD"}})})
	listings.decision.reasons == ["price_above_ceiling"] with input as typo
}

test_services_without_a_price_are_allowed if {
	tutor := object.union(base, {"listing": object.union(base.listing, {"category": "services", "subcategory": "tutoring", "country": "XS", "price": null})})
	listings.decision.allow with input as tutor
}

test_prohibited_terms_match_whole_words if {
	gun := object.union(base, {"listing": object.union(base.listing, {"title": "Pent brukt våpen"})})
	listings.decision.reasons == ["prohibited_item"] with input as gun
	safe := object.union(base, {"listing": object.union(base.listing, {"title": "Våpenskap i stål"})})
	listings.decision.allow with input as safe
}

test_jobs_have_no_price_ceiling if {
	job := object.union(base, {"listing": {"category": "jobb", "subcategory": "it", "title": "Utvikler", "description": "Fast stilling", "country": "NO", "price": null, "imageCount": 1}})
	listings.decision.allow with input as job
}

test_image_limit if {
	many := object.union(base, {"listing": object.union(base.listing, {"imageCount": 11})})
	listings.decision.reasons == ["too_many_images"] with input as many
}
