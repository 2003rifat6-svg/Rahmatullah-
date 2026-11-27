O='zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()
T='_ _ twenty thirty forty fifty sixty seventy eighty ninety'.split()
def h(n):
    r=[]
    if n>=100: r+= [O[n//100],'hundred']; n%=100
    if n>=20: r.append(T[n//10]); n%=10; 
    if n or not r: r.append(O[n]) if n else None
    return r
def num2words(n):
    if n==0: return 'zero'
    r=[]
    for v,name in [(10**9,'billion'),(10**6,'million'),(1000,'thousand')]:
        if n>=v: r+=h(n//v)+[name]; n%=v
    if n: r+=h(n)
    return ' '.join(x for x in r if x)
