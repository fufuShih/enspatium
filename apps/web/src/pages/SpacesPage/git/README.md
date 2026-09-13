# Git pages

Code and Settings are the Space's main tabs. The Space name and page width stay consistent; returning from Settings preserves the previous Code location. Files, Commits and Compare are secondary tools within Code. Settings remains visible only to managers.

The file table shows the last commit that changed each entry on the selected snapshot's first-parent history, including folder changes and merge introductions. One bounded Git log read supplies the rows (up to 2,000 commits / 8 MiB); unavailable or older metadata shows `Commit unavailable` while files remain browsable. Times use the committer date, with the full local date and timezone on hover.

The latest-commit row links to snapshot-pinned history and counts all reachable commits, including merged branches. If counting is unavailable, the history link remains usable. Compare and commit details share a two-column diff with aligned changes and independent line numbers; narrow screens scroll horizontally.

Frontend URLs are relative to `/:account/:spaceSlug`:

- `/branch/:name`, `/tag/:name`: browse a reference; append `/tree/:path` for folders.
- `/branch/:name/file/:path`: open a file, then pin it to `/branch/:name/at/:commit/file/:path`. Tags work the same way.
- `/commit/:hash`: commit details; append `/file/:path` to select a diff.
- `/branch/:name/commits`: history; `/at/:hash` pins pagination to a snapshot.
- Old `/branches` and `/tags` list URLs redirect to the file browser. Use its Branch / Tag selectors to switch versions.
- `/compare/:from/:to/at/:base/:head`: compare two fully qualified references at fixed commits; `/file/:path` selects a diff.

Only history pagination uses query parameters. `gitRoutes.ts` builds and parses paths; ref names are encoded as single segments, including `/` and literal `%`. Parse the raw pathname once rather than decoding React Router params again. Old query-based URLs redirect with replacement. Commit URLs are independent of branches; browser history may retain the reference and history page used to reach them. Generated backend API URLs remain unchanged.
