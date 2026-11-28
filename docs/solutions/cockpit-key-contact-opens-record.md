# Cockpit key contact opens the record

## Problem

The account cockpit lists key contacts as plain text. On the demo book that is the buying group (Michael Johnson, Sarah Patel, and David Liang at CI Financial). Opening the person meant leaving the account and searching Contacts. A name search can match a different person.

## Solution

A row whose id is a contact uuid links to `/contacts/<id>`. The visible name is not part of the address. A short fixture id, a script, a path, or a blank stays text. The link is at least 44px tall, has a 2px focus ring, and uses the dark brand color in dark mode. The accessible name says the row opens the contact.
