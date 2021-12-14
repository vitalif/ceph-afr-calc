import * as preact from 'preact';
/** @jsx preact.h */
import { cluster_afr } from './afr.js';

class Calc extends preact.Component
{
    state = {
        hosts: 10,
        drives: 10,
        afr_drive: 3,
        afr_host: 5,
        capacity: 8,
        speed: 20,
        pg_per_osd: 100,
        ec: false,
        replicas: 2,
        ec_data: 2,
        ec_parity: 1,
        eager: false,
        same_host: true,
        result: 0,
        use_speed: true,
    }

    calc(st)
    {
        st = { ...this.state, ...st };
        st.result = 100*cluster_afr({
            n_hosts: st.hosts,
            n_drives: st.drives,
            afr_drive: st.afr_drive/100,
            afr_host: st.afr_host/100,
            capacity: st.capacity*1000,
            speed: st.use_speed ? st.speed/1000 : null,
            disk_heal_hours: st.use_speed ? null : st.disk_heal_hours,
            ec: st.ec,
            ec_data: st.ec_data,
            ec_parity: st.ec_parity,
            replicas: st.replicas,
            pgs: st.pg_per_osd,
            osd_rm: !st.same_host,
            degraded_replacement: st.eager,
            down_out_interval: 600,
        });
        this.setState(st);
    }

    setter(field)
    {
        if (!this.setter[field])
        {
            this.setter[field] = (event) =>
            {
                this.calc({ [field]: event.target.value });
            };
        }
        return this.setter[field];
    }

    setRepl = () =>
    {
        this.calc({ ec: false });
    }

    setEC = () =>
    {
        this.calc({ ec: true });
    }

    setEager = (event) =>
    {
        this.calc({ eager: event.target.checked });
    }

    useSpeed = () =>
    {
        this.calc({ use_speed: true, speed: this.state.speed || 20 });
    }

    useTime = () =>
    {
        this.calc({ use_speed: false, disk_heal_hours: 12 });
    }

    setSameHost = (event) =>
    {
        this.calc({ same_host: event.target.checked });
    }

    format4 = (n) =>
    {
        if (n >= 1 || n <= -1)
            return ''+(Math.round(n*10000)/10000);
        if (n == 0)
            return '0';
        let s = '0.', i = 0, c = 0;
        if (n < 0)
        {
            s = '-0.';
            n = -n;
        }
        while (n && i < 4)
        {
            n = n*10;
            s += (n|0);
            c = c || (n|0);
            n = n-(n|0);
            if (c)
                i++;
        }
        return s;
    }

    componentDidMount()
    {
        this.calc({});
    }

    render(props, state)
    {
        return (<div style="width: 750px; margin: 20px; padding: 20px; box-shadow: 0 19px 60px rgba(0, 0, 0, 0.3), 0 15px 20px rgba(0, 0, 0, 0.22);">
            <h2 style="text-align: center; font-size: 150%; margin: 10px 0 20px 0; font-weight: bold">
                Калькулятор вероятности отказа кластера Ceph/Vitastor
            </h2>
            <p>
                Вероятность потери данных в кластере зависит от числа серверов и дисков
                (чем их больше, тем вероятность больше), от схемы избыточности, скорости ребаланса (восстановления),
                и, конечно, непосредственно вероятности выхода из строя самих дисков и серверов.
            </p>
            <p>
                Рассчитывается оценка сверху. Расчёт ведётся в простом предположении, что отказы распределены равномерно во времени.
            </p>
            <table>
                <tr>
                    <th>Число серверов</th>
                    <td><input type="text" value={state.hosts} onchange={this.setter('hosts')} /></td>
                </tr>
                <tr>
                    <th>Число дисков в сервере</th>
                    <td><input type="text" value={state.drives} onchange={this.setter('drives')} /></td>
                </tr>
                <tr>
                    <th>Ёмкость дисков</th>
                    <td><input type="text" value={state.capacity} onchange={this.setter('capacity')} /> ТБ</td>
                </tr>
                <tr>
                    <th>Схема избыточности</th>
                    <td>
                        <label class={"switch l"+(state.ec ? "" : " sel")}>
                            <input type="radio" name="scheme" checked={!state.ec} onclick={this.setRepl} /> Репликация
                        </label>
                        <label class={"switch r"+(state.ec ? " sel" : "")}>
                            <input type="radio" name="scheme" checked={state.ec} onclick={this.setEC} /> EC (коды коррекции ошибок)
                        </label>
                    </td>
                </tr>
                {state.ec ? null : <tr>
                    <th>Число реплик</th>
                    <td><input type="text" value={state.replicas} onchange={this.setter('replicas')} /></td>
                </tr>}
                {state.ec ? <tr>
                    <th>Число дисков данных</th>
                    <td><input type="text" value={state.ec_data} onchange={this.setter('ec_data')} /></td>
                </tr> : null}
                {state.ec ? <tr>
                    <th>Число дисков чётности</th>
                    <td><input type="text" value={state.ec_parity} onchange={this.setter('ec_parity')} /></td>
                </tr> : null}
                <tr>
                    <th>
                        {state.use_speed ? 'Оценочная' : 'Оценочное'}&nbsp;
                        <span className="icombo">
                            {state.use_speed ? 'скорость' : 'время'} <span className="icon-arw-down"></span>
                            <span className="options">
                                <span className="option" onClick={this.useSpeed}>скорость</span>
                                <span className="option" onClick={this.useTime}>время</span>
                            </span>
                        </span>
                        <br />восстановления на 1 OSD
                    </th>
                    {state.use_speed
                        ? <td><input type="text" value={state.speed} onchange={this.setter('speed')} /> МБ/с</td>
                        : <td><input type="text" value={state.disk_heal_hours} onchange={this.setter('disk_heal_hours')} /> час(ов)</td>}
                </tr>
                <tr>
                    <th><abbr title="Среднее число уникальных групп чётности (пар/троек и т.п.), включающих каждый отдельный диск. В Ceph нормой считается 100 PG на OSD">PG на OSD</abbr></th>
                    <td><input type="text" value={state.pg_per_osd} onchange={this.setter('pg_per_osd')} /></td>
                </tr>
                <tr>
                    <th><abbr title="Annualized Failure Rate, вероятность отказа в течение года в %">AFR</abbr> диска</th>
                    <td><input type="text" value={state.afr_drive} onchange={this.setter('afr_drive')} /> %</td>
                </tr>
                <tr>
                    <th><abbr title="Вероятность отказа сервера сразу со всеми дисками, без возвращения их в строй">AFR сервера</abbr></th>
                    <td><input type="text" value={state.afr_host} onchange={this.setter('afr_host')} /> %</td>
                </tr>
            </table>
            <p>
                <label><input type="checkbox" checked={state.same_host} onchange={this.setSameHost} />
                    При отказе диска данные распределяются только по другим дискам того же сервера,
                    как в Ceph
                </label>
            </p>
            <p>
                <label><input type="checkbox" checked={state.eager} onchange={this.setEager} />
                    Я нетерпеливый и заменяю отказавший диск сразу, не давая данным уехать на остальные диски
                    (либо данным уезжать некуда, например, сервера всего 3 при 3 репликах)
                </label>
            </p>
            <div style="text-align: center; font-size: 150%; margin: 20px 0; font-weight: bold">
                Вероятность потери данных в течение года:
            </div>
            <div style="text-align: center; font-size: 200%; margin: 20px 0; font-weight: bold">
                {this.format4(state.result)} %
            </div>
            <div style="text-align: center; color: #aaa; margin: 10px 0">
                &copy; Виталий Филиппов 2020+ <a style="color: inherit" href="https://yourcmc.ru/git/vitalif/ceph-afr-calc">(исходники)</a>
            </div>
        </div>);
    }
}

preact.render(<Calc />, document.body);
