# menu-check-and-notify Specification

## Purpose

TBD - created by archiving change 'lunch-photo-push-service'. Update Purpose after archive.

## Requirements

### Requirement: Scheduled menu check scoped to pending schools

WHEN the scheduled trigger runs, the system SHALL query the source menu API only for `school_id` values that have at least one active subscription AND do not already have a `notification_log` entry for the current date.

#### Scenario: Already-notified school is skipped

- **WHEN** the scheduled trigger runs and a subscribed school already has a `notification_log` entry for today
- **THEN** the system SHALL NOT query the source API for that school during this run

---
### Requirement: Photo-published detection and daily dedup

WHEN a queried school's menu for the current date contains at least one dish with a non-empty `PicturePath`, the system SHALL create a `notification_log` entry for that `school_id` and date, and SHALL send a push notification to every active subscription for that school.

#### Scenario: First dish with a photo triggers notification

- **WHEN** a school's queried menu contains at least one dish where `PicturePath` is non-empty
- **THEN** the system SHALL create a `notification_log` entry for that school and today's date and SHALL send a push notification to all of that school's subscriptions

#### Scenario: Menu exists but no photos yet

- **WHEN** a school's queried menu exists but every dish has an empty `PicturePath`
- **THEN** the system SHALL NOT create a `notification_log` entry and SHALL NOT send a notification, so the school SHALL be queried again on the next scheduled run

---
### Requirement: Notification payload content

The push notification payload SHALL include a title, a body, and a URL that links to the frontend's view of that school's menu for that date, with `schoolId` and the date included as query parameters.

#### Scenario: Payload includes deep link

- **WHEN** the system sends a push notification for a school whose photo was just detected
- **THEN** the payload's `url` field SHALL contain that school's `schoolId` and the current date as query parameters

---
### Requirement: Delivery failure tracking

WHEN a push delivery attempt returns HTTP 410 Gone, the system SHALL increment the corresponding subscription's `failure_count`.

#### Scenario: 410 response increments failure count

- **WHEN** a push delivery attempt to a subscription returns HTTP 410 Gone
- **THEN** the system SHALL increment that subscription's `failure_count` by 1
