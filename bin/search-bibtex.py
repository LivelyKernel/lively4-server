#!/usr/bin/python3

import sys
from scholarly import scholarly

query = scholarly.search_pubs(sys.argv[1])
pub = next(query)
print(pub.bibtex)