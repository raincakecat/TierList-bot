# Fight template ordering

The /format command prints fight sections in progression order, from prerequisites to the tier being tested:

| Target | Section order |
| --- | --- |
| HT3 | HT3 |
| LT2 | HT3, LT2 |
| HT2 | LT2, HT2 |
| LT1 | LT2, HT2, LT1 |
| HT1 | LT2, HT2, LT1, HT1 |

HT3 includes Passed Evaluation and one placeholder fight. Higher templates include two placeholder fights per section. The title, mentions and editable Markdown remain the same.

Inside a testing ticket, use `/format tier:HT1` (or the appropriate tier) to post a fresh template. Updating source or restarting the bot does not rewrite existing, edited or forwarded messages. Discord forwards preserve the snapshot captured at forwarding time. Existing fight scores are not overwritten automatically.

October 31 verification: the running compiled generator and both source repositories already used the progression above. An automated regression now checks every supported high-test target, including placeholder counts. The full suite passes 178 tests.
