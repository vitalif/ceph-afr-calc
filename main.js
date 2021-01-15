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
        ec: false,
        replicas: 2,
        ec_data: 2,
        ec_parity: 1,
        eager: false,
        result: 0,
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
            speed: st.speed/1000,
            ec: st.ec ? [ st.ec_data, st.ec_parity ] : null,
            replicas: st.replicas,
            pgs: 50,
            degraded_replacement: st.eager,
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

    format4 = (n) =>
    {
        let p = Math.abs(n-(n|0)), m = 10000;
        while (p != 0 && p < 0.1)
        {
            p = p*10;
            m = m*10;
        }
        return Math.round(n*m)/m;
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
                Вероятность полного отказа кластера зависит от числа серверов и дисков
                (чем их больше, тем вероятность больше), от схемы избыточности, скорости ребаланса (восстановления),
                и, конечно, непосредственно вероятности выхода из строя самих дисков и серверов.
            </p>
            <p>
                Расчёт ведётся в простом предположении, что отказы распределены равномерно во времени.
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
                    <th>Оценочная скорость<br />восстановления на 1 OSD</th>
                    <td><input type="text" value={state.speed} onchange={this.setter('speed')} /> МБ/с</td>
                </tr>
                <tr>
                    <th><abbr title="Annualized Failure Rate, вероятность отказа в течение года в %">AFR</abbr> диска</th>
                    <td><input type="text" value={state.afr_drive} onchange={this.setter('afr_drive')} /> %</td>
                </tr>
                <tr>
                    <th>AFR сервера</th>
                    <td><input type="text" value={state.afr_host} onchange={this.setter('afr_host')} /> %</td>
                </tr>
            </table>
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
