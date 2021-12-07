// Functions to calculate Annualized Failure Rate of your cluster
// if you know AFR of your drives, number of drives, expected rebalance time
// and replication factor
// License: VNPL-1.0 (see https://yourcmc.ru/git/vitalif/vitastor/src/branch/master/README.md for details) or AGPL-3.0
// Author: Vitaliy Filippov, 2020+

module.exports = {
    cluster_afr_fullmesh,
    failure_rate_fullmesh,
    cluster_afr,
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
