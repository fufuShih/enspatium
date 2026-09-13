# Git pages

The file table shows the last commit that changed each entry on the selected snapshot's first-parent history, including folder changes and merge introductions. One bounded Git log read supplies the rows (up to 2,000 commits / 8 MiB); unavailable or older metadata shows `Commit unavailable` while files remain browsable. Times use the committer date, with the full local date and timezone on hover.

Frontend URLs are relative to `/:account/:spaceSlug`:

- `/branch/:name`, `/tag/:name`: browse a reference; append `/tree/:path` for folders.
- `/branch/:name/file/:path`: open a file, then pin it to `/branch/:name/at/:commit/file/:path`. Tags work the same way.
- `/commit/:hash`: commit details; append `/file/:path` to select a diff.
- `/branch/:name/commits`: history; `/at/:hash` pins pagination to a snapshot.
- `/branches`, `/tags`: reference lists.
- `/compare/:from/:to/at/:base/:head`: compare two fully qualified references at fixed commits; `/file/:path` selects a diff.

Only search and pagination use query parameters. `gitRoutes.ts` builds and parses paths; ref names are encoded as single segments, including `/` and literal `%`. Parse the raw pathname once rather than decoding React Router params again. Old query-based URLs redirect with replacement. Commit URLs are independent of branches; browser history may retain the reference and history page used to reach them. Generated backend API URLs remain unchanged.
