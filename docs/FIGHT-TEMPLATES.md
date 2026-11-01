# Fight template ordering

The /format command prints fight sections from highest tier to lowest:

| Target | Section order |
| --- | --- |
| HT3 | HT3 |
| LT2 | LT2, HT3 |
| HT2 | HT2, LT2 |
| LT1 | LT1, HT2, LT2 |
| HT1 | HT1, LT1, HT2, LT2 |

HT3 includes Passed Evaluation and one placeholder fight. Higher templates include two placeholder fights per section. The title, mentions and editable Markdown remain the same.

Inside a testing ticket, use `/format tier:HT1` (or the appropriate tier) to post a fresh template. Updating source or restarting the bot does not rewrite existing, edited or forwarded messages. Discord forwards preserve the snapshot captured at forwarding time. Existing fight scores are not overwritten automatically.

October 31 update: the generator now orders sections highest to lowest. Regression coverage checks all five supported high-test targets and their placeholder counts. The full suite passes 178 tests.
