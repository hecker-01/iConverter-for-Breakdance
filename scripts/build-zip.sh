#!/bin/sh

set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(node -p "require(process.argv[1]).version" "$project_dir/package.json")
archive="$project_dir/dist/iconverter-$version.zip"

mkdir -p "$project_dir/dist"
rm -f "$archive"

cd "$project_dir/plugin"
zip -qr "$archive" iconverter \
	-x 'iconverter/THIRD-PARTY-NOTICES.txt' \
	-x 'iconverter/*.zip' \
	-x '*/.DS_Store' \
	-x '*/__MACOSX/*'

printf '%s\n' "Created $archive"
