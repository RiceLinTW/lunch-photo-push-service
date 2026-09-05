## ADDED Requirements

### Requirement: Import the official school directory

The system SHALL import the Ministry of Education's official elementary, junior high, and senior high school directories into a local `school_directory` table, keyed by `school_code`. Re-running the import SHALL update existing rows rather than creating duplicates.

#### Scenario: Import populates the directory

- **WHEN** the import is run against the three official directory sources
- **THEN** the `school_directory` table SHALL contain one row per school with `school_code`, `school_name`, `county`, and `school_stage`

#### Scenario: Re-running the import does not duplicate rows

- **WHEN** the import is run a second time against the same source data
- **THEN** the total row count in `school_directory` SHALL remain unchanged, and existing rows SHALL be updated in place

### Requirement: Search the directory by county and name

The system SHALL provide a search over `school_directory` filtered by an optional county and a school-name substring match.

#### Scenario: Search by name within a county

- **WHEN** a client searches with a county and a name keyword that matches part of a school's name in that county
- **THEN** the system SHALL return that school in the result list

##### Example: county-scoped keyword match

- **GIVEN** `school_directory` contains `{school_code:"024701", school_name:"縣立清溝國小", county:"宜蘭縣"}`
- **WHEN** a client searches with `county="宜蘭縣"` and `q="清溝"`
- **THEN** the result list SHALL include `024701`

#### Scenario: Search does not require an exact name match

- **WHEN** a client searches with a keyword that is a substring of a school's full name but not the full name itself
- **THEN** the system SHALL still return that school in the result list

##### Example: partial keyword still matches

- **GIVEN** `school_directory` contains `{school_code:"333609", school_name:"市立公館國小", county:"臺北市"}`
- **WHEN** a client searches with `county="臺北市"` and `q="公館"` (not the full name)
- **THEN** the result list SHALL include `333609`

### Requirement: Verify a candidate school code before accepting it

WHEN a client selects a school from search results, the system SHALL determine whether that school's official `school_code` can be used as the live platform's `SchoolId` before allowing the user to proceed to subscription.

#### Scenario: Cached verification is reused

- **WHEN** a `school_code` already has an entry in `verified_school_ids`
- **THEN** the system SHALL return that cached `school_id` without querying the external platform again

#### Scenario: Verification succeeds within the retry window

- **WHEN** a `school_code` has no cached verification, and querying the external platform's meal offering for that code returns real data on any of the most recent 7 days checked
- **THEN** the system SHALL record the verification in `verified_school_ids` and return the confirmed `school_id`

#### Scenario: Verification is inconclusive, not treated as failure

- **WHEN** a `school_code` has no cached verification, and querying the external platform's meal offering for that code returns no data for all of the most recent 7 days checked
- **THEN** the system SHALL report that the code could not be confirmed, SHALL NOT write an entry to `verified_school_ids`, and SHALL NOT claim the code is invalid

### Requirement: Manual entry remains available as a fallback

WHEN directory search does not find a school, or verification cannot confirm a selected school's code, the system SHALL allow the user to manually enter a `SchoolId` as before.

#### Scenario: Manual entry after inconclusive verification

- **WHEN** verification for a selected school is inconclusive
- **THEN** the system SHALL present the manual `SchoolId` entry option instead of blocking the user
