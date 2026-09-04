## ADDED Requirements

### Requirement: Subscribe to a school

The system SHALL accept a subscription request containing a `schoolId` and a browser Web Push subscription (`endpoint`, `keys.p256dh`, `keys.auth`), and SHALL create or update a subscription record keyed by `endpoint`.

#### Scenario: New subscription created

- **WHEN** a client submits a subscribe request with a `schoolId` and a push subscription whose `endpoint` does not yet exist in storage
- **THEN** the system SHALL create a new subscription record with that `schoolId`, `endpoint`, `p256dh`, and `auth`

#### Scenario: Existing endpoint re-subscribes to a different school

- **WHEN** a client submits a subscribe request whose `endpoint` already exists in storage but with a different `schoolId`
- **THEN** the system SHALL update the existing record's `schoolId` instead of creating a duplicate record

### Requirement: Unsubscribe from a school

The system SHALL accept an unsubscribe request containing an `endpoint` and SHALL delete the matching subscription record.

#### Scenario: Successful unsubscribe

- **WHEN** a client submits an unsubscribe request with an `endpoint` that matches an existing subscription record
- **THEN** the system SHALL delete that record

#### Scenario: Unsubscribe for unknown endpoint

- **WHEN** a client submits an unsubscribe request with an `endpoint` that does not match any existing subscription record
- **THEN** the system SHALL return a success response without error

### Requirement: Minimal data collection

The system SHALL store only `schoolId`, `endpoint`, `p256dh`, `auth`, `created_at`, `last_notified_date`, and `failure_count` for each subscription. The system SHALL NOT store any other personally identifying fields (such as name, email, or child information).

#### Scenario: Subscribe request with extra fields

- **WHEN** a subscribe request payload includes fields beyond `schoolId` and the push subscription object
- **THEN** the system SHALL ignore those extra fields and SHALL NOT persist them

### Requirement: Automatic removal of invalid subscriptions

The system SHALL track a `failure_count` per subscription. WHEN a push delivery attempt to a subscription returns HTTP 410 Gone, the system SHALL increment that subscription's `failure_count`. WHEN a subscription's `failure_count` reaches 3 consecutive failures, the system SHALL delete that subscription record.

#### Scenario: Three consecutive 410 responses

- **WHEN** three consecutive push delivery attempts to the same subscription each return HTTP 410 Gone
- **THEN** the system SHALL delete that subscription record after the third failure

#### Scenario: Failure count resets after success

- **WHEN** a push delivery attempt to a subscription succeeds after prior failures
- **THEN** the system SHALL reset that subscription's `failure_count` to 0
