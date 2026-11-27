# Sample watchdog news stays sample on the intel summary

## Problem

Demo accounts such as CI Financial store watchdog stories with source `sample` and an empty source URL. The company intel news read labels those rows. The list summary still filed them as ordinary news: `sample: false` and the source label `sample`. That story becomes the signal when the account has no other post, so the signal reads as a live post.

## Solution

The summary uses the same rule as the news read. Source `sample` is sample data, labelled "Sample data", with no URL. A real source such as GDELT stays live.

## Verification

`packages/db` `company-intel-summary.sample-news.test.ts`.
