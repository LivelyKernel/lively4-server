#!/usr/bin/python3
#
# Print Bibtex Entry for the first match of a given Scholar query:
#

import sys
from scholarly import scholarly


query = scholarly.search_pubs(sys.argv[1])
pub = next(query)       
        
print(pub.bibtex)