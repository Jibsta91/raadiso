# Tests for the decision-log mask (log.rego): text a user typed never reaches the decision logs.
package system.log_test

import rego.v1

import data.system.log

test_listing_text_is_masked if {
	"/input/listing/title" in log.mask
	"/input/listing/description" in log.mask
}
