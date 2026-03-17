#!/usr/bin/env python3
"""
LobbyDog Index Builder

Fetches all entries from the German Lobbyregister API, then fetches detail
pages to extract legalRepresentatives and entrustedPersons, and builds a
compact name→entity index JSON file for the browser extension.

Usage:
    python index_builder.py [--output lobby-index.json] [--delay 0.2]
"""

import argparse
import json
import time

import requests

API_BASE = "https://www.lobbyregister.bundestag.de"
PAGE_SIZE = 100
SESSION = requests.Session()


def fetch_all_entries():
    """Fetch the full search listing to get registerNumber + entityId pairs."""
    url = f"{API_BASE}/sucheJson"
    params = {"page": 0, "pageSize": PAGE_SIZE}

    print("  Fetching search listing...", end=" ", flush=True)
    resp = SESSION.get(url, params=params, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    entries = data.get("results", [])
    print(f"got {len(entries)} entries")
    return entries


def fetch_detail(register_number, entity_id):
    """Fetch the detail JSON for a single entry."""
    url = f"{API_BASE}/sucheJson/{register_number}/{entity_id}"
    resp = SESSION.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def build_index(entries, delay):
    """Build a name→{entityId, registerNumber} lookup, enriched with person names."""
    index = {}
    total = len(entries)

    for i, entry in enumerate(entries):
        register_number = entry.get("registerNumber", "")
        details = entry.get("registerEntryDetails", {})
        entity_id = str(details.get("registerEntryId", ""))

        if not entity_id or not register_number:
            continue

        # Main name from search listing
        identity = entry.get("lobbyistIdentity", {})
        is_natural = identity.get("identity") == "NATURAL"
        info = {"entityId": entity_id, "registerNumber": register_number}
        if is_natural:
            info["p"] = 1

        name = (identity.get("name") or "").strip()
        if name:
            index[name] = info

        # Fetch detail page for person names
        if (i + 1) % 100 == 0 or i == 0:
            print(f"  Fetching details: {i + 1}/{total}...", flush=True)

        try:
            detail = fetch_detail(register_number, entity_id)
            detail_identity = detail.get("lobbyistIdentity", {})

            # Index legal representatives
            for person in detail_identity.get("legalRepresentatives", []):
                add_person(index, person, info)

            # Index entrusted persons
            for person in detail_identity.get("entrustedPersons", []):
                add_person(index, person, info)

        except requests.RequestException as e:
            print(f"  Warning: failed to fetch detail for {register_number}/{entity_id}: {e}")

        if delay > 0:
            time.sleep(delay)

    return index


def add_person(index, person, info):
    """Add a person's full name to the index if long enough."""
    first = (person.get("firstName") or "").strip()
    last = (person.get("lastName") or "").strip()
    full_name = f"{first} {last}".strip()
    if full_name and len(full_name) > 4:
        # Don't overwrite org entry with person entry
        if full_name not in index:
            person_info = {**info, "p": 1}
            index[full_name] = person_info


def main():
    parser = argparse.ArgumentParser(description="Build LobbyDog name index")
    parser.add_argument(
        "--output", "-o",
        default="lobby-index.json",
        help="Output file path (default: lobby-index.json)",
    )
    parser.add_argument(
        "--delay", "-d",
        type=float,
        default=0.2,
        help="Delay in seconds between detail requests (default: 0.2)",
    )
    args = parser.parse_args()

    print("LobbyDog Index Builder")
    print("=" * 40)
    print(f"Source: {API_BASE}")
    print(f"Delay between detail requests: {args.delay}s")
    print()

    print("Fetching entries from Lobbyregister API...")
    entries = fetch_all_entries()
    print(f"Total entries: {len(entries)}")
    est_minutes = len(entries) * args.delay / 60
    print(f"Estimated time for detail fetching: ~{est_minutes:.0f} min")
    print()

    print("Building name index (fetching detail pages)...")
    index = build_index(entries, args.delay)
    print(f"Total names indexed: {len(index)}")
    print()

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=None, separators=(",", ":"))

    file_size = len(json.dumps(index, ensure_ascii=False))
    print(f"Index written to: {args.output}")
    print(f"Index size: {file_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
