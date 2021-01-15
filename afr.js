// Functions to calculate Annualized Failure Rate of your cluster
// if you know AFR of your drives, number of drives, expected rebalance time
// and replication factor
// License: VNPL-1.0 (see https://yourcmc.ru/git/vitalif/vitastor/src/branch/master/README.md for details) or AGPL-3.0
// Author: Vitaliy Filippov, 2020+

module.exports = {
    cluster_afr_fullmesh,
    failure_rate_fullmesh,
    cluster_afr,
    print_cluster_afr,
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
function cluster_afr_pgs({ n_hosts, n_drives, afr_drive, capacity, speed, replicas, pgs = 1, osd_rm, degraded_replacement, down_out_interval = 600 })
{
    pgs = Math.min(pgs, (n_hosts-1)*n_drives/(replicas-1));
    const resilver_disk = n_drives == 1 || osd_rm ? pgs : (n_drives-1);
    const disk_heal_time = (down_out_interval + capacity/(degraded_replacement ? 1 : resilver_disk)/speed)/86400/365;
    return 1 - (1 - afr_drive * (1-(1-(afr_drive*disk_heal_time)**(replicas-1))**pgs)) ** (n_hosts*n_drives);
}

function cluster_afr_pgs_ec({ n_hosts, n_drives, afr_drive, capacity, speed, ec: [ ec_data, ec_parity ], pgs = 1, osd_rm, degraded_replacement, down_out_interval = 600 })
{
    const ec_total = ec_data+ec_parity;
    pgs = Math.min(pgs, (n_hosts-1)*n_drives/(ec_total-1));
    const resilver_disk = n_drives == 1 || osd_rm ? pgs : (n_drives-1);
    const disk_heal_time = (down_out_interval + capacity/(degraded_replacement ? 1 : resilver_disk)/speed)/86400/365;
    return 1 - (1 - afr_drive * (1-(1-failure_rate_fullmesh(ec_total-1, afr_drive*disk_heal_time, ec_parity))**pgs)) ** (n_hosts*n_drives);
}

// Same as above, but also take server failures into account
function cluster_afr_pgs_hosts({ n_hosts, n_drives, afr_drive, afr_host, capacity, speed, replicas, pgs = 1, osd_rm, degraded_replacement, down_out_interval = 600 })
{
    const otherhosts = Math.min(pgs, (n_hosts-1)/(replicas-1));
    pgs = Math.min(pgs, (n_hosts-1)*n_drives/(replicas-1));
    const resilver_disk = n_drives == 1 || osd_rm ? pgs : (n_drives-1);
    const pgh = Math.min(pgs*n_drives, (n_hosts-1)*n_drives/(replicas-1));
    const disk_heal_time = (down_out_interval + capacity/(degraded_replacement ? 1 : resilver_disk)/speed)/86400/365;
    const host_heal_time = (down_out_interval + n_drives*capacity/pgs/speed)/86400/365;
    const p1 = ((afr_drive+afr_host*pgs/otherhosts)*host_heal_time);
    const p2 = ((afr_drive+afr_host*pgs/otherhosts)*disk_heal_time);
    return 1 - ((1 - afr_host * (1-(1-p1**(replicas-1))**pgh)) ** n_hosts) *
        ((1 - afr_drive * (1-(1-p2**(replicas-1))**pgs)) ** (n_hosts*n_drives));
}

function cluster_afr_pgs_ec_hosts({ n_hosts, n_drives, afr_drive, afr_host, capacity, speed, ec: [ ec_data, ec_parity ], pgs = 1, osd_rm, degraded_replacement, down_out_interval = 600 })
{
    const ec_total = ec_data+ec_parity;
    const otherhosts = Math.min(pgs, (n_hosts-1)/(ec_total-1));
    pgs = Math.min(pgs, (n_hosts-1)*n_drives/(ec_total-1));
    const resilver_disk = n_drives == 1 || osd_rm ? pgs : (n_drives-1);
    const pgh = Math.min(pgs*n_drives, (n_hosts-1)*n_drives/(ec_total-1));
    const disk_heal_time = (down_out_interval + capacity/(degraded_replacement ? 1 : resilver_disk)/speed)/86400/365;
    const host_heal_time = (down_out_interval + n_drives*capacity/pgs/speed)/86400/365;
    const p1 = ((afr_drive+afr_host*pgs/otherhosts)*host_heal_time);
    const p2 = ((afr_drive+afr_host*pgs/otherhosts)*disk_heal_time);
    return 1 - ((1 - afr_host * (1-(1-failure_rate_fullmesh(ec_total-1, p1, ec_parity))**pgh)) ** n_hosts) *
        ((1 - afr_drive * (1-(1-failure_rate_fullmesh(ec_total-1, p2, ec_parity))**pgs)) ** (n_hosts*n_drives));
}

// Wrapper for 4 above functions
function cluster_afr(config)
{
    if (config.ec && config.afr_host)
    {
        return cluster_afr_pgs_ec_hosts(config);
    }
    else if (config.ec)
    {
        return cluster_afr_pgs_ec(config);
    }
    else if (config.afr_host)
    {
        return cluster_afr_pgs_hosts(config);
    }
    else
    {
        return cluster_afr_pgs(config);
    }
}

function print_cluster_afr(config)
{
    console.log(
        `${config.n_hosts} nodes with ${config.n_drives} ${sprintf("%.1f", config.capacity/1000)}TB drives`+
        `, capable to backfill at ${sprintf("%.1f", config.speed*1000)} MB/s, drive AFR ${sprintf("%.1f", config.afr_drive*100)}%`+
        (config.afr_host ? `, host AFR ${sprintf("%.1f", config.afr_host*100)}%` : '')+
        (config.ec ? `, EC ${config.ec[0]}+${config.ec[1]}` : `, ${config.replicas} replicas`)+
        `, ${config.pgs||1} PG per OSD`+
        (config.degraded_replacement ? `\n...and you don't let the rebalance finish before replacing drives` : '')
    );
    console.log('-> '+sprintf("%.7f%%", 100*cluster_afr(config))+'\n');
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
