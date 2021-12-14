// Functions to calculate Annualized Failure Rate of your cluster
// if you know AFR of your drives, number of drives, expected rebalance time
// and replication factor
// License: VNPL-1.0 (see https://yourcmc.ru/git/vitalif/vitastor/src/branch/master/README.md for details) or AGPL-3.0
// Author: Vitaliy Filippov, 2020+

module.exports = {
    cluster_afr_fullmesh,
    failure_rate_fullmesh,
    cluster_afr,
    cluster_afr_bruteforce,
    c_n_k,
};

/******** "FULL MESH": ASSUME EACH OSD COMMUNICATES WITH ALL OTHER OSDS ********/

// Estimate AFR of the cluster
// n - number of drives
// afr - annualized failure rate of a single drive
// l - expected rebalance time in days after a single drive failure
// k - replication factor / number of drives that must fail at the same time for the cluster to fail
function cluster_afr_fullmesh(n, afr, l, k)
{
    return 1 - (1 - afr * failure_rate_fullmesh(n-(k-1), afr*l/365, k-1)) ** (n-(k-1));
}

// Probability of at least <f> failures in a cluster with <n> drives with AFR=<a>
function failure_rate_fullmesh(n, a, f)
{
    if (f <= 0)
    {
        return (1-a)**n;
    }
    let p = 1;
    for (let i = 0; i < f; i++)
    {
        p -= c_n_k(n, i) * (1-a)**(n-i) * a**i;
    }
    return p;
}

/******** PGS: EACH OSD ONLY COMMUNICATES WITH <pgs> OTHER OSDs ********/

// <n> hosts of <m> drives of <capacity> GB, each able to backfill at <speed> GB/s,
// <k> replicas, <pgs> unique peer PGs per OSD (~50 for 100 PG-per-OSD in a big cluster)
//
// For each of n*m drives: P(drive fails in a year) * P(any of its peers fail in <l*365> next days).
// More peers per OSD increase rebalance speed (more drives work together to resilver) if you
// let them finish rebalance BEFORE replacing the failed drive (degraded_replacement=false).
// At the same time, more peers per OSD increase probability of any of them to fail!
// osd_rm=true means that failed OSDs' data is rebalanced over all other hosts,
// not over the same host as it's in Ceph by default (dead OSDs are marked 'out').
//
// Probability of all except one drives in a replica group to fail is (AFR^(k-1)).
// So with <x> PGs it becomes ~ (x * (AFR*L/365)^(k-1)). Interesting but reasonable consequence
// is that, with k=2, total failure rate doesn't depend on number of peers per OSD,
// because it gets increased linearly by increased number of peers to fail
// and decreased linearly by reduced rebalance time.
function cluster_afr({ n_hosts, n_drives, afr_drive, afr_host, capacity, speed, disk_heal_hours, host_heal_hours,
    ec, ec_data, ec_parity, replicas, pgs = 1, osd_rm, degraded_replacement, down_out_interval = 0 })
{
    const pg_size = (ec ? ec_data+ec_parity : replicas);
    // <peers> is a number of non-intersecting PGs that a single OSD/drive has on average
    const peers = avg_distinct((n_hosts-1)*n_drives, pgs*(pg_size-1))/(pg_size-1);
    // <host_peers> is a number of non-intersecting PGs that a single host has on average
    const host_peers = avg_distinct((n_hosts-1)*n_drives, pgs*(pg_size-1)*n_drives)/(pg_size-1);
    // <resilver_peers> other drives participate in resilvering of a single failed drive
    const resilver_peers = n_drives == 1 || osd_rm ? avg_distinct((n_hosts-1)*n_drives, pgs) : avg_distinct(n_drives-1, pgs);
    // <host_resilver_peers> other drives participate in resilvering of a failed host
    const host_resilver_peers = avg_distinct((n_hosts-1)*n_drives, n_drives*pgs);
    let disk_heal_time, host_heal_time;
    if (speed)
        disk_heal_time = (down_out_interval + capacity/(degraded_replacement ? 1 : resilver_peers)/speed)/86400/365;
    else
    {
        disk_heal_time = disk_heal_hours/24/365;
        speed = capacity / (degraded_replacement ? 1 : resilver_peers) / (disk_heal_hours*3600 - down_out_interval);
    }
    if (host_heal_hours)
        host_heal_time = host_heal_hours/24/365;
    else
        host_heal_time = (down_out_interval + n_drives*capacity/host_resilver_peers/speed)/86400/365;
    const disk_heal_fail = ((afr_drive+afr_host/n_drives)*disk_heal_time);
    const host_heal_fail = ((afr_drive+afr_host/n_drives)*host_heal_time);
    const disk_pg_fail = ec
        ? failure_rate_fullmesh(ec_data+ec_parity-1, disk_heal_fail, ec_parity)
        : disk_heal_fail**(replicas-1);
    const host_pg_fail = ec
        ? failure_rate_fullmesh(ec_data+ec_parity-1, host_heal_fail, ec_parity)
        : host_heal_fail**(replicas-1);
    return 1 - ((1 - afr_drive * (1-(1-disk_pg_fail)**peers)) ** (n_hosts*n_drives))
        * ((1 - afr_host * (1-(1-host_pg_fail)**host_peers)) ** n_hosts);
}

// Accurate brute-force based calculation, but only for replicated setups
function cluster_afr_bruteforce({ n_hosts, n_drives, afr_drive, disk_heal_hours, replicas, pgs = 1 })
{
    // N-wise replication
    // - Generate random pgs
    // - For each of them
    //   - Drive #1 dies within a year
    //     - Drive #2 dies within +- recovery time around #1 death time
    //       - afr*2*recovery_time/year probability
    //       - Drive #3 dies within +- recovery time around #1 and #2
    //         - afr*1.5*recovery_time/year probability
    //         - Drive #4 dies within +- recovery time around #1 and #2 and #3
    //           - etc...
    //           - integral of max(t-|x-y|, 0), max(min(t-|x-y|, t-|x-z|, t-|y-z|), 0), and so on
    //           - AFRCoeff(DriveNum >= 3) = 2*(0.5 + PyramidVolume/NCubeVolume)
    //           - PyramidVolume(N) = 1/N * (BaseSquare=2^(N-1)) * (Height=1)
    //           - AFRCoeff(DriveNum >= 3) = 1 + 1/(DriveNum-1)
    //           - so AFRCoeff for 2 3 4 5 6 ... = 2 1.5 1.33 1.25 1.2 ...
    //       - Drive #3 dies but not within recovery time
    //       - Drive #3 does not die
    //     - Drive #2 dies but not within recovery time
    //     - Drive #2 does not die
    //   - Drive #1 does not die within a year
    // - After each step we know we accounted for ALL drive #1 death probability
    //   AND for (1-AFR) portion of drive #2 death probability (all cases where #2 dies with #1 are already accounted)
    //   AND for (1-AFR)^2 portion of drive #3 death probability (#3 dying with #1 and #3 already accounted)
    //   AND so on
    let pg_set = [];
    let per_osd = {};
    /*
    // Method 1: each drive has at least <pgs>
    for (let i = 1; i <= n_hosts*n_drives; i++)
    {
        while (!per_osd[i] || per_osd[i] < pgs)
        {
            const host1 = Math.floor((i-1) / n_drives);
            let host2 = Math.floor(Math.random()*(n_hosts-1));
            if (host2 >= host1)
                host2++;
            const osd2 = 1 + host2*n_drives + Math.floor(Math.random()*n_drives);
            pg_set.push([ i, osd2 ]);
            per_osd[i] = (per_osd[i] || 0) + 1;
            per_osd[osd2] = (per_osd[osd2] || 0) + 1;
        }
    }
    */
    // Method 2: N_OSD*PG_PER_OSD/REPLICAS
    for (let i = 0; i <= n_hosts*n_drives*pgs/replicas; i++)
    {
        const pg_hosts = [];
        while (pg_hosts.length < replicas)
        {
            let host = Math.floor(Math.random()*(n_hosts-pg_hosts.length));
            for (let i = 0; i < pg_hosts.length; i++)
            {
                if (host < pg_hosts[i])
                    break;
                host++;
            }
            pg_hosts.push(host);
            pg_hosts.sort();
        }
        const pg_osds = pg_hosts.map(host => 1 + host*n_drives + Math.floor(Math.random()*n_drives));
        pg_set.push(pg_osds);
        pg_osds.forEach(osd => per_osd[osd] = (per_osd[osd] || 0) + 1);
    }
    let result = 1;
    let maydie = {};
    for (let i = 1; i <= n_hosts*n_drives; i++)
    {
        maydie[i] = afr_drive;
    }
    for (let pg of pg_set)
    {
        let i;
        for (i = 0; i < pg.length && maydie[pg[i]] > 0; i++) {}
        if (i < pg.length)
            continue;
        let pg_death = maydie[pg[0]] * disk_heal_hours/365/24 * 2 * maydie[pg[1]];
        for (i = 2; i < pg.length; i++)
        {
            pg_death *= disk_heal_hours/365/24 * (1 + 1/i) * maydie[pg[i]];
        }
        result *= (1 - pg_death);
        let cur = maydie[pg[0]];
        for (i = 1; i < pg.length; i++)
        {
            // portion of drive #i death probability equal to multiplication of
            // all prev drives death probabilities is already accounted for
            const next = cur*maydie[pg[i]];
            maydie[pg[i]] *= (1 - cur);
            cur = next;
        }
        maydie[pg[0]] = 0; // all drive #1 death probability is already accounted for
    }
    /*
    // replicas = 2
    for (let pg of pg_set)
    {
        if (maydie[pg[0]] > 0 && maydie[pg[1]] > 0)
        {
            result *= (1 - disk_heal_hours/365/24 * 2 * maydie[pg[0]] * maydie[pg[1]]);
            maydie[pg[1]] *= (1-maydie[pg[0]]); // drive #1 is not dead
            maydie[pg[0]] = 0; // drive #1 death probability is already accounted for
        }
    }
    */
    return 1-result;
}

/******** UTILITY ********/

// Combination count
function c_n_k(n, k)
{
    let r = 1;
    for (let i = 0; i < k; i++)
    {
        r *= (n-i) / (i+1);
    }
    return r;
}

// Average birthdays for K people with N total days
function avg_distinct(n, k)
{
    return n * (1 - (1 - 1/n)**k);
}

/*

Examples:

console.log(100*cluster_afr({ n_hosts: 4, n_drives: 4, afr_drive: 0.05, afr_host: 0, capacity: 4, disk_heal_hours: 24, replicas: 2, pgs: 10 }), '%');
console.log(100*cluster_afr_bruteforce({ n_hosts: 4, n_drives: 4, afr_drive: 0.05, afr_host: 0, capacity: 4, disk_heal_hours: 24, replicas: 2, pgs: 10 }), '%');
console.log(100*cluster_afr({ n_hosts: 2500, n_drives: 80, afr_drive: 0.006, afr_host: 0, capacity: 10, disk_heal_hours: 18, replicas: 2, pgs: 10 }), '%');
console.log(100*cluster_afr_bruteforce({ n_hosts: 2500, n_drives: 80, afr_drive: 0.006, afr_host: 0, capacity: 10, disk_heal_hours: 18, replicas: 2, pgs: 10 }), '%');

*/
