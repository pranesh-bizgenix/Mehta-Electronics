-- Enable Owner-configured independent contract reviewers without granting any
-- non-Owner role these permissions by default. Applied contract data is untouched.
UPDATE permissions SET owner_only=false WHERE key IN ('contracts.manage','contracts.approve');
