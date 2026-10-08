# Tests for OPA's own API authorization (authz.rego): a client token may only read decisions under
# data.raadi; everything else (other data, policies, writes, unknown tokens) is refused.
package system.authz_test

import rego.v1

import data.system.authz

tokens := {"listings": "token-listings"}

decide(method, path, identity) if {
	authz.allow with input as {"method": method, "path": path, "identity": identity}
		with data.secrets.tokens as tokens
}

test_health_and_metrics_are_open if {
	decide("GET", ["health"], "")
	decide("GET", ["metrics"], "")
}

test_a_client_reads_raadi_decisions if {
	decide("POST", ["v1", "data", "raadi", "listings", "allow"], "token-listings")
	decide("GET", ["v1", "data", "raadi", "listings"], "token-listings")
}

test_an_unknown_token_is_refused if {
	not decide("POST", ["v1", "data", "raadi", "listings", "allow"], "token-other")
	not decide("POST", ["v1", "data", "raadi", "listings", "allow"], "")
}

test_writes_are_refused if {
	not decide("PUT", ["v1", "data", "raadi", "listings"], "token-listings")
	not decide("PATCH", ["v1", "data", "raadi", "listings"], "token-listings")
	not decide("DELETE", ["v1", "data", "raadi", "listings"], "token-listings")
}

test_other_data_and_policies_are_refused if {
	# The token data itself, the system package and the policy API stay closed.
	not decide("GET", ["v1", "data", "secrets", "tokens"], "token-listings")
	not decide("GET", ["v1", "data", "system", "authz"], "token-listings")
	not decide("GET", ["v1", "policies"], "token-listings")
	not decide("GET", ["v1", "data"], "token-listings")
}
